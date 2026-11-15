import astropy
from fastapi.testclient import TestClient

from app import __version__
from app.main import app

client = TestClient(app)


def test_health_says_ok_with_versions():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "version": __version__, "astropy": astropy.__version__}


def test_api_docs_are_served():
    assert client.get("/api/docs").status_code == 200
    assert client.get("/api/openapi.json").json()["info"]["title"] == "SPHEREx TimeLens API"


def test_unknown_path_is_404():
    assert client.get("/api/nope").status_code == 404
