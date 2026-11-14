"""Tests that talk to NASA, IRSA and MAST. Skip them offline with: pytest -m "not network"."""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.network

# detector wavelength ranges in micrometres, with a little room at the edges
BANDS = {1: (0.70, 1.12), 2: (1.05, 1.70), 3: (1.58, 2.45), 4: (2.38, 3.87), 5: (3.78, 4.45), 6: (4.37, 5.05)}


def _search(client, slug):
    t = client.get("/api/resolve", params={"q": slug}).json()
    params = {k: t[k] for k in ("ra", "dec", "epoch_mjd") if t.get(k) is not None}
    params |= {k: t[k] for k in ("pmra", "pmdec") if t.get(k) is not None}
    r = client.get("/api/observations", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_resolve_name_via_mast():
    with TestClient(app) as client:
        r = client.get("/api/resolve", params={"q": "RW Aur"})
    assert r.status_code == 200
    assert r.json()["ra"] == pytest.approx(76.9565, abs=0.01)


def test_unknown_name_is_404():
    with TestClient(app) as client:
        assert client.get("/api/resolve", params={"q": "zzqx not a star 123"}).status_code == 404


def test_barnards_star_search():
    with TestClient(app) as client:
        res = _search(client, "barnard")
    frames = res["frames"]
    assert res["complete"] and len(frames) >= 350  # old site, 14 Nov 2026: 358 (239 DR1 + 119 QR3)
    assert set(res["by_release"]) <= {"dr1", "qr3"}
    weeks: dict[str, set] = {}
    for f in frames:
        weeks.setdefault(f["week"], set()).add(f["release"])
        assert 0.5 <= f["x"] <= 2040.5 and 0.5 <= f["y"] <= 2040.5
        lo, hi = BANDS[f["det"]]
        assert lo <= f["lambda_um"] <= hi, f
        assert 0 < f["dlambda_um"] < 0.2
    assert all(len(r) == 1 for r in weeks.values())  # one release per week
    assert [f["mjd"] for f in frames] == sorted(f["mjd"] for f in frames)


def test_stream_ends_with_the_same_result():
    with TestClient(app) as client:
        t = client.get("/api/resolve", params={"q": "barnard"}).json()
        params = {k: t[k] for k in ("ra", "dec", "epoch_mjd", "pmra", "pmdec")}
        with client.stream("GET", "/api/observations/stream", params=params) as r:
            events = [line[7:] for line in r.iter_lines() if line.startswith("event: ")]
            # the last data line holds the result
    assert events[-1] == "result"
    assert json.dumps(events)  # stream parsed


@pytest.mark.parametrize("slug, old_site", [("wise-0855", 258), ("rw-aur", 333), ("eps-indi-b", 458), ("r-dra", 797)])
def test_counts_match_the_old_site(slug, old_site):
    """The old site found these on 14 Nov 2026. QR3 grows weekly, so allow growth, never loss."""
    with TestClient(app) as client:
        res = _search(client, slug)
    assert res["count"] >= old_site - 6, (res["count"], res["by_release"])
