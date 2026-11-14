"""Offline Phase 3 tests: sky index, catalogues, previews, status, and hostile input (no network)."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import archive, catalogs, skyindex
from app.services.frames import position_at

BARNARD = position_at(269.4520769586187, 4.6933649665767, 51544.5, -801.551, 10362.394, 61040)


# ── sky index ──────────────────────────────────────────────────────────────


def test_index_covers_every_week():
    cov = skyindex.coverage()
    assert cov == {"weeks": 151, "indexed_weeks": 151, "observations": 101080}


def test_index_proposes_a_known_barnard_exposure():
    ids = {i for c in skyindex.candidates(*BARNARD) for i in c["ids"]}
    # Barnard's Star is on detector 3/6 of 2025W33_2C observation 321, exposure 1 (QR2 copy of the DR1 file)
    assert any("2025W33_2C" in i and "_0321_1D6_" in i and i.startswith("qr2/") for i in ids)
    assert len(ids) > 500


def test_week_mjd():
    assert skyindex.week_mjd("2025W33_2C") == pytest.approx(60902, abs=4)  # files say MJD 60902.86


def test_search_falls_back_to_the_index_when_irsa_is_down(monkeypatch):
    async def down(client):
        return False

    monkeypatch.setattr(archive, "irsa_reachable", down)
    found = asyncio.run(archive.find_candidates(None, *BARNARD))
    assert found["sources"] == ["index"] and found["complete"]
    assert found["errors"] == {"irsa": "unreachable"} and "sky index" in found["notes"][0]
    weeks: dict[str, set] = {}
    for c in found["candidates"]:
        weeks.setdefault(c["week"], set()).add(c["release"])
        assert c["ids"][0] == c["id"]
    assert all(len(r) == 1 for r in weeks.values())  # still one release per week


# ── catalogues ─────────────────────────────────────────────────────────────


def _rows(*rows):
    async def fake(client, query):
        return [dict(r) for r in rows]

    return fake


def test_gaia_asks_esa_then_irsa(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "cache_dir", tmp_path)

    async def esa_down(client, query):
        raise catalogs.CatalogError("ESA: ConnectError")

    monkeypatch.setattr(catalogs, "_esa", esa_down)
    monkeypatch.setattr(
        catalogs, "_irsa", _rows({"ra": "1", "dec": "2", "phot_g_mean_mag": "9.5", "pmra": "", "pmdec": "3"})
    )
    out = asyncio.run(catalogs.catalog(None, "gaia", 10, 20, 0.05))
    assert out["source"] == "Gaia DR3 via IRSA" and out["epoch_mjd"] == 57388.5
    assert out["rows"] == [{"ra": 1.0, "dec": 2.0, "mag": 9.5, "pmra": None, "pmdec": 3.0}]
    again = asyncio.run(catalogs.catalog(None, "gaia", 10, 20, 0.05))
    assert again["from_cache"] and again["rows"] == out["rows"]  # served from disk next time


def test_catwise_keeps_only_significant_motion(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "cache_dir", tmp_path)
    monkeypatch.setattr(
        catalogs,
        "_irsa",
        _rows(
            {
                "ra": "1",
                "dec": "2",
                "w2mpro": "12",
                "pmra": "-8.1",
                "pmdec": "0.7",
                "sigpmra": "0.1",
                "sigpmdec": "0.1",
            },
            {"ra": "3", "dec": "4", "w2mpro": "16", "pmra": "0.2", "pmdec": "0.1", "sigpmra": "0.3", "sigpmdec": "0.3"},
        ),
    )
    rows = asyncio.run(catalogs.catalog(None, "wise", 10, 20, 0.05))["rows"]
    assert rows[0]["pmra"] == pytest.approx(-8100) and rows[0]["pmdec"] == pytest.approx(700)  # arcsec/yr -> mas/yr
    assert rows[1]["pmra"] is None  # noise, not motion


def test_catalog_endpoint(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "cache_dir", tmp_path)

    async def down(client, query):
        raise catalogs.CatalogError("down")

    monkeypatch.setattr(catalogs, "_irsa", down)
    monkeypatch.setattr(catalogs, "_esa", down)
    with TestClient(app) as c:
        assert c.get("/api/catalogs/gaia", params={"ra": 10, "dec": 20, "r": 0.05}).status_code == 503
        assert c.get("/api/catalogs/sdss", params={"ra": 10, "dec": 20, "r": 0.05}).status_code == 422
        assert c.get("/api/catalogs/wise", params={"ra": 10, "dec": 20, "r": 5}).status_code == 422


# ── previews and status ────────────────────────────────────────────────────


def test_previews_only_serve_known_targets(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "cache_dir", tmp_path)
    gif = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"
    (tmp_path / "previews").mkdir()
    (tmp_path / "previews" / "barnard.p1.gif").write_bytes(gif)
    with TestClient(app) as c:
        ok = c.get("/api/previews/barnard.gif")
        assert ok.status_code == 200 and ok.content == gif and ok.headers["content-type"] == "image/gif"
        for bad in ("vega.gif", "barnard", "..%2F..%2Fapp%2Fmain.py", "%2e%2e%2fmain.gif", "barnard.gif.gif"):
            assert c.get(f"/api/previews/{bad}").status_code == 404, bad


def test_status(monkeypatch):
    async def up(client):
        return True

    monkeypatch.setattr("app.routers.status.irsa_reachable", up)
    with TestClient(app) as c:
        s = c.get("/api/status").json()
    assert s["irsa"] is True and s["coverage"]["indexed_weeks"] == 151
    assert set(s["net"]) == {"requests", "bytes", "retries", "not_found", "failed"}


# ── hostile input ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path, params",
    [
        ("/api/observations", {"ra": "nan", "dec": 0}),
        ("/api/observations", {"ra": "inf", "dec": 0}),
        ("/api/observations", {"ra": 10, "dec": "-91"}),
        ("/api/observations", {"ra": 10, "dec": 0, "pmra": "1e9"}),
        ("/api/cutouts/one", {"id": "x", "ra": "nan", "dec": 0, "n": 39}),
        ("/api/cutouts/one", {"id": "x", "ra": 1, "dec": 0, "n": "39.5"}),
        ("/api/pixels", {"id": "x", "x": -1, "y": 1}),
        ("/api/catalogs/gaia", {"ra": 1, "dec": 0, "r": "nan"}),
    ],
)
def test_bad_numbers_are_refused(path, params):
    with TestClient(app) as c:
        assert c.get(path, params=params).status_code == 422


@pytest.mark.parametrize(
    "id_",
    [
        "../../../etc/passwd",
        "dr1/level2/../../secret.fits",
        "https://evil.example/x.fits",
        "dr1/level2/2025W33_2C/l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_x.fits?x=1",
    ],
)
def test_path_tricks_in_ids_are_refused(id_):
    with TestClient(app) as c:
        assert c.get("/api/cutouts/one", params={"id": id_, "ra": 1, "dec": 0, "n": 39}).status_code == 400
        assert c.get("/api/pixels", params={"id": id_, "x": 5, "y": 5}).status_code == 400


def test_bad_bodies_are_refused():
    with TestClient(app) as c:
        assert c.post("/api/cutouts/batch", content=b"\xff\xfe garbage").status_code == 422
        assert c.post("/api/cutouts/batch", json=[1, 2, 3]).status_code == 422
        assert c.post("/api/cutouts/batch", json={"ids": "not a list", "ra": 1, "dec": 0, "n": 39}).status_code == 422
        assert c.post("/api/cutouts/batch", content=b"x" * 200_000).status_code == 413
        assert c.get("/api/resolve", params={"q": "a" * 5000}).status_code == 422
        assert c.get("/api/../app/main.py").status_code == 404
