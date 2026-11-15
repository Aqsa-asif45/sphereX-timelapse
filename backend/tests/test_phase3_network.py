"""Live Phase 3 tests, with IRSA reachable and with IRSA blocked.
Quick live check: pytest -m "network and not slow". Everything: pytest -m network."""

import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.main import app
from app.services import archive, catalogs, cutouts, indexer, skyindex

pytestmark = pytest.mark.network

DEAD = "http://127.0.0.1:9"  # nothing listens here: every request fails at once
BARNARD = {"ra": 269.4520769586187, "dec": 4.6933649665767, "epoch_mjd": 51544.5, "pmra": -801.551, "pmdec": 10362.394}


@pytest.fixture
def irsa_blocked(monkeypatch):
    """Point every IRSA address at a dead port, as if IRSA were down."""
    monkeypatch.setattr(archive, "IRSA", DEAD)
    monkeypatch.setattr(archive, "SIA_URL", DEAD + "/SIA")
    monkeypatch.setattr(archive, "TAP_URL", DEAD + "/TAP/sync")
    monkeypatch.setattr(catalogs, "TAP_URL", DEAD + "/TAP/sync")
    monkeypatch.setattr(cutouts, "IRSA_FILES", DEAD + "/ibe/data/spherex/")
    monkeypatch.setattr(archive, "_irsa_state", {"ok": None, "at": 0.0})
    yield
    archive._irsa_state.update(ok=None, at=0.0)


@pytest.fixture
def fresh_searches(monkeypatch, tmp_path):
    """Searches run for real (no saved answers); headers and cutouts still come from the cache."""
    monkeypatch.setattr(settings, "no_search_cache", True)


def _exposures(res):
    return {(f["week"], f["obs"], f["exp"], f["det"]) for f in res["frames"]}


def test_status_both_ways(irsa_blocked):
    with TestClient(app) as c:
        s = c.get("/api/status").json()
    assert s["irsa"] is False and s["coverage"]["indexed_weeks"] == 151


def test_status_irsa_up():
    archive._irsa_state.update(ok=None, at=0.0)
    with TestClient(app) as c:
        assert c.get("/api/status").json()["irsa"] is True


@pytest.mark.slow  # two full Barnard's Star searches (~1,300 file headers)
def test_search_with_irsa_blocked_matches_irsa(fresh_searches, monkeypatch):
    with TestClient(app) as c:
        via_irsa = c.get("/api/observations", params=BARNARD).json()
    assert "index" not in via_irsa["sources"]
    monkeypatch.setattr(archive, "IRSA", DEAD)
    monkeypatch.setattr(archive, "SIA_URL", DEAD + "/SIA")
    monkeypatch.setattr(archive, "TAP_URL", DEAD + "/TAP/sync")
    monkeypatch.setattr(archive, "_irsa_state", {"ok": None, "at": 0.0})
    with TestClient(app) as c:
        via_index = c.get("/api/observations", params=BARNARD).json()
    archive._irsa_state.update(ok=None, at=0.0)
    assert via_index["sources"] == ["index"]
    assert set(via_index["by_release"]) <= {"qr2", "qr3"}  # DR1 has no local index: its QR2/QR3 copies are used
    a, b = _exposures(via_irsa), _exposures(via_index)
    assert len(a & b) >= 0.95 * len(a), (len(a), len(b), len(a & b))  # same exposures, found without IRSA
    for f in via_index["frames"]:
        assert 0.5 <= f["x"] <= 2040.5 and 0.5 <= f["y"] <= 2040.5


def test_gaia_with_irsa_blocked(irsa_blocked, monkeypatch, tmp_path):
    """Gaia comes from ESA first, so it works with IRSA down."""
    monkeypatch.setattr(settings, "cache_dir", tmp_path)
    with TestClient(app) as c:
        r = c.get("/api/catalogs/gaia", params={"ra": 269.4463, "dec": 4.7682, "r": 0.04})
    assert r.status_code == 200 and r.json()["source"] == "Gaia DR3 via ESA" and r.json()["count"] > 10


@pytest.mark.slow  # IRSA's catalogue service can take minutes
def test_gaia_same_rows_from_esa_and_irsa(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "cache_dir", tmp_path)
    params = {"ra": 269.4463, "dec": 4.7682, "r": 0.04}
    with TestClient(app) as c:
        esa = c.get("/api/catalogs/gaia", params=params).json()
    monkeypatch.setattr(settings, "cache_dir", tmp_path / "second")
    monkeypatch.setattr(catalogs, "ESA_TAP", DEAD + "/tap")
    with TestClient(app) as c:
        irsa = c.get("/api/catalogs/gaia", params=params).json()
    assert esa["source"] == "Gaia DR3 via ESA" and irsa["source"] == "Gaia DR3 via IRSA"
    key = lambda r: (round(r["ra"], 6), round(r["dec"], 6))  # noqa: E731
    assert esa["count"] > 10 and sorted(map(key, irsa["rows"])) == sorted(map(key, esa["rows"]))


def test_wise_blocked_is_reported(irsa_blocked, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "cache_dir", tmp_path)
    with TestClient(app) as c:
        down = c.get("/api/catalogs/wise", params={"ra": 133.76, "dec": -7.2422, "r": 0.04})
    assert down.status_code == 503 and "unavailable" in down.json()["detail"]  # said out loud, never a crash


@pytest.mark.slow  # IRSA's catalogue service can take minutes
def test_wise_up_and_blocked(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "cache_dir", tmp_path)
    params = {"ra": 133.7600, "dec": -7.2422, "r": 0.04}  # around WISE 0855
    with TestClient(app) as c:
        up = c.get("/api/catalogs/wise", params=params)
    assert up.status_code == 200 and up.json()["count"] > 0
    monkeypatch.setattr(settings, "cache_dir", tmp_path / "second")
    monkeypatch.setattr(catalogs, "TAP_URL", DEAD + "/TAP/sync")
    with TestClient(app) as c:
        down = c.get("/api/catalogs/wise", params=params)
    assert down.status_code == 503 and "unavailable" in down.json()["detail"]  # said out loud, never a crash


def test_cutouts_and_pixels_work_with_irsa_blocked(irsa_blocked):
    key = "dr1/level2/2025W33_2C/l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits"
    with TestClient(app) as c:
        one = c.get("/api/cutouts/one", params={"id": key, "ra": 269.446269, "dec": 4.768197, "n": 39})
        px = c.get("/api/pixels", params={"id": key, "x": 1628, "y": 269, "r": 1})
        missing = c.get(
            "/api/cutouts/one",
            params={
                "id": key.replace("0321_1D6", "9999_1D6").replace("_0321_", "_9999_"),
                "ra": 269.446269,
                "dec": 4.768197,
                "n": 39,
            },
        )
    assert one.status_code == 200 and len(one.content) == 39 * 39 * 4
    assert px.status_code == 200 and len(px.json()["values"]) == 3
    assert missing.status_code == 502  # an id that is not on AWS: reported, never a blank image


@pytest.mark.slow  # first build needs every Barnard's Star cutout
def test_preview_is_a_real_animation():
    from app.services.previews import preview_path

    with TestClient(app) as c:
        r = c.get("/api/previews/barnard.gif")
        if r.status_code == 404:  # not built yet: build it now (as `app.cli warm` does)
            import asyncio

            import httpx

            from app.services.previews import build

            async def make():
                async with httpx.AsyncClient(follow_redirects=True) as h:
                    await build(h, asyncio.Semaphore(32), "barnard")

            asyncio.run(make())
            r = c.get("/api/previews/barnard.gif")
    assert r.status_code == 200 and preview_path("barnard").exists()
    img = Image.open(io.BytesIO(r.content))
    assert img.size == (312, 312) and img.n_frames >= 3  # one frame per SPHEREx visit (Barnard: 3 so far)


@pytest.mark.slow  # lists and reads ~600 observations from AWS
def test_index_builder_reproduces_a_committed_week(monkeypatch, tmp_path):
    """Rebuild one small week from AWS into a temp folder; it must match the index file in git."""
    import asyncio

    import httpx

    folder = min(
        (f for f in skyindex.folders() if f["release"] == "qr3" and skyindex.load_index(f["release"], f["name"])),
        key=lambda f: len(skyindex.load_index(f["release"], f["name"])["rows"]),
    )
    committed = json.loads((skyindex.INDEX_DIR / f"{folder['release']}_{folder['name']}.json").read_text())
    monkeypatch.setattr(skyindex, "INDEX_DIR", tmp_path)

    async def run():
        async with httpx.AsyncClient(follow_redirects=True) as h:
            return await indexer.index_week(h, asyncio.Semaphore(32), folder)

    got = asyncio.run(run())
    rebuilt = json.loads((tmp_path / f"{folder['release']}_{folder['name']}.json").read_text())
    skyindex.load_index.cache_clear()
    assert got["unreadable"] == 0
    old = {r[0]: r for r in committed["rows"]}
    new = {r[0]: r for r in rebuilt["rows"]}
    assert set(old) == set(new)  # the same observations
    same = [o for o in new if (new[o][1], new[o][8]) == (old[o][1], old[o][8])]
    assert len(same) >= 0.8 * len(new)
    for obs in same:  # read from the same exposure and detector: identical pointing and pixel matrix
        assert new[obs][2:8] == pytest.approx(old[obs][2:8], abs=1e-9)
    # the rest were read from another exposure of the same observation (newer "retry" folders hold only
    # some exposures); any of the 4 is a valid pointing, because the search checks all 4 anyway
    assert all(1 <= r[1] <= 4 and 1 <= r[8] <= 6 for r in new.values())
