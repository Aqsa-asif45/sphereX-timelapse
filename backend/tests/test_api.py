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


def test_observations_rejects_bad_positions():
    with TestClient(app) as client:
        assert client.get("/api/observations", params={"ra": 400, "dec": 0}).status_code == 422
        assert client.get("/api/observations", params={"ra": 10}).status_code == 422  # dec missing
        assert client.get("/api/observations", params={"ra": "abc", "dec": 0}).status_code == 422
