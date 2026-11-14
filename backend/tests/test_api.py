from fastapi.testclient import TestClient

from app.main import app


def test_targets():
    with TestClient(app) as client:
        r = client.get("/api/targets")
    assert r.status_code == 200
    assert [t["slug"] for t in r.json()] == ["barnard", "eps-indi-b", "wise-0855", "rw-aur", "r-dra"]


def test_resolve_coordinates_and_errors():
    with TestClient(app) as client:
        ok = client.get("/api/resolve", params={"q": "08h55m10.8s -07d14m42s"})
        empty = client.get("/api/resolve", params={"q": ""})
        too_long = client.get("/api/resolve", params={"q": "x" * 201})
    assert ok.status_code == 200 and round(ok.json()["ra"], 3) == 133.795
    assert empty.status_code == 400
    assert too_long.status_code == 422


def test_observations_passes_every_parameter_through(monkeypatch):
    """Regression: pmdec used to be read from pmra (a shared FastAPI Query object)."""
    seen = {}

    async def fake_search(client, ra, dec, epoch_mjd, pmra, pmdec, report=None):
        seen.update(ra=ra, dec=dec, epoch_mjd=epoch_mjd, pmra=pmra, pmdec=pmdec)
        return {"count": 1, "errors": {}}

    monkeypatch.setattr("app.routers.observations.search", fake_search)
    params = {"ra": 269.45, "dec": 4.69, "epoch_mjd": 51544.5, "pmra": -801.551, "pmdec": 10362.394}
    with TestClient(app) as client:
        assert client.get("/api/observations", params=params).status_code == 200
    assert seen == params
    with TestClient(app) as client:
        assert client.get("/api/observations", params={"ra": 10, "dec": 20}).status_code == 200
    assert seen == {"ra": 10, "dec": 20, "epoch_mjd": 51544.5, "pmra": None, "pmdec": None}


def test_observations_rejects_bad_positions():
    with TestClient(app) as client:
        assert client.get("/api/observations", params={"ra": 400, "dec": 0}).status_code == 422
        assert client.get("/api/observations", params={"ra": 10}).status_code == 422  # dec missing
        assert client.get("/api/observations", params={"ra": "abc", "dec": 0}).status_code == 422
