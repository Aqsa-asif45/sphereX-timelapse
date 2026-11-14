"""Offline tests: coordinate parsing, provenance parsing, release rule, flag definitions, API validation."""
import astropy.units as u
import pytest
from astropy.coordinates import SkyCoord
from astropy.io import fits
from fastapi.testclient import TestClient

from app import archive, coords, fitsio
from app.config import release_rank
from app.main import app


@pytest.mark.parametrize("q", [
    "08h55m10.831s -07d14m42.53s", "08:55:10.831 -07:14:42.53", "08 55 10.831 -07 14 42.53",
    "08h55m10.831s −07°14′42.53″",  # how the apps print coordinates (typographic minus, primes)
])
def test_wise_0855_challenge_coordinates(q):
    ra, dec = coords.parse_coords(q)
    ref = SkyCoord("08h55m10.831s", "-07d14m42.53s", frame="icrs")
    assert ra == pytest.approx(ref.ra.deg, abs=1e-7) and dec == pytest.approx(ref.dec.deg, abs=1e-7)
    assert ra == pytest.approx(133.7951292, abs=1e-6) and dec == pytest.approx(-7.2451472, abs=1e-6)


@pytest.mark.parametrize("q,ra,dec", [
    ("133.795 -7.245", 133.795, -7.245), ("133.795, −7.245", 133.795, -7.245), ("0 0", 0, 0),
    ("12 00 00 -00 30 00", 180.0, -0.5), ("23:59:59.9 +89:59:59", 359.99958, 89.99972),
])
def test_coordinate_formats(q, ra, dec):
    got = coords.parse_coords(q)
    assert got is not None and got[0] == pytest.approx(ra, abs=1e-4) and got[1] == pytest.approx(dec, abs=1e-4)


@pytest.mark.parametrize("q", ["400 100", "10 95", "Barnard's Star", "", "hello world"])
def test_not_coordinates(q):
    assert coords.parse_coords(q) is None


def test_provenance_from_url():
    url = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W33_2C/l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits"
    p = archive.provenance_from_url(url)
    assert p == {"pipeline": "l2b", "version": "v27", "processing_date": "2026-08-16", "week": "2025W33_2C", "large_slew": 321, "small_slew": 1, "detector": 6}


def test_release_rule():
    assert release_rank("dr1") > release_rank("qr3") > release_rank("qr2") > release_rank("bogus")

    def obs(rel):
        return archive.Observation(obs_id="x", release=rel, collection="c", survey="wide", week="2025W33_2C", large_slew=1, small_slew=1, detector=1,
                                   mjd=1.0, utc="", lambda_min_um=1, lambda_max_um=1, access_url="", cutout_capable=True, pipeline="", version="",
                                   processing_date="", adapter="", retrieved_utc="")
    kept = archive.one_release_per_week([obs("qr2"), obs("dr1"), obs("qr3")])
    assert [o.release for o in kept] == ["dr1"]


def _obs(rel, slew, adapter):
    return archive.Observation(obs_id=f"{rel}{slew}", release=rel, collection=f"spherex_{rel}", survey="wide", week="2026W34_1A" if rel == "qr3" else "2025W33_2C",
                               large_slew=slew, small_slew=1, detector=2, mjd=float(slew), utc="", lambda_min_um=1.0, lambda_max_um=1.1, access_url="",
                               cutout_capable=True, pipeline="l2b", version="v27", processing_date="2026-08-16", adapter=adapter, retrieved_utc="")


def test_partial_sia_failure_is_filled_from_tap_and_reported(monkeypatch):
    async def fake_sia(client, ra, dec, r, collection):
        if collection == "spherex_qr3":
            raise archive.ArchiveError("SIA2 (spherex_qr3) unreachable: ReadError")
        return [_obs("dr1", 1, "IRSA SIA2")]

    async def fake_tap(client, ra, dec):
        return [_obs("dr1", 1, "IRSA TAP"), _obs("qr3", 2, "IRSA TAP")]

    monkeypatch.setattr(archive, "sia_search", fake_sia)
    monkeypatch.setattr(archive, "tap_search", fake_tap)
    import asyncio
    res = asyncio.run(archive.search(None, 1.0, 1.0))
    assert res["by_release"] == {"dr1": 1, "qr3": 1} and res["complete"] is True
    assert res["adapter"] == "IRSA SIA2 + TAP" and "spherex_qr3" in res["errors"] and "filled in from IRSA TAP" in res["notes"][0]
    assert [o["adapter"] for o in res["observations"]] == ["IRSA SIA2", "IRSA TAP"]  # SIA2's copy kept where both list it


def test_total_failure_is_reported_incomplete(monkeypatch):
    async def fail(*a, **k):
        raise archive.ArchiveError("unreachable")
    monkeypatch.setattr(archive, "sia_search", fail)
    monkeypatch.setattr(archive, "tap_search", fail)
    import asyncio
    res = asyncio.run(archive.search(None, 1.0, 1.0))
    assert res["count"] == 0 and res["complete"] is False and "incomplete" in res["notes"][0]


def test_flag_definitions_both_styles():
    h = fits.Header()
    h["MSKN0000"], h["MSKD0000"] = "TRANSIENT", "cosmic ray"
    h["MSKN0021"], h["MSKN0022"] = "SOURCE", "GHOST"
    qr2 = fits.Header()
    qr2["MP_HOT"] = 10
    d = fitsio.flag_definitions(h, qr2)
    assert d[0] == {"name": "TRANSIENT", "description": "cosmic ray", "category": "bad"}
    assert d[21]["category"] == "info" and d[22]["category"] == "artifact" and d[10]["name"] == "HOT"


@pytest.mark.parametrize("url", [
    "https://evil.example.com/x.fits", "https://irsa.ipac.caltech.edu/ibe/data/spherex/../../etc/passwd.fits",
    "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/a.fits?center=1,1", "http://169.254.169.254/latest/meta-data",
])
def test_cutout_refuses_non_spherex_urls(url):
    with pytest.raises(ValueError):
        fitsio.check_file_url(url)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # runs the app's startup (shared HTTP client)
        yield c


def test_api_health_and_targets(client):
    assert client.get("/api/v2/health").json()["ok"] is True
    t = client.get("/api/v2/targets").json()
    assert len(t) == 5
    assert {x["name"] for x in t if x["kind"] == "brown dwarf"} == {"Epsilon Indi B", "WISE 0855−0714"}


def test_api_validation(client):
    assert client.get("/api/v2/observations", params={"ra": 400, "dec": 0}).status_code == 422
    assert client.get("/api/v2/observations").status_code == 422  # missing position is an error, never RA 0, Dec 0
    assert client.get("/api/v2/observations", params={"ra": 1, "dec": 1, "collections": "spherex_qr2"}).status_code == 400
    assert client.get("/api/v2/cutout", params={"url": "https://evil.example.com/x.fits", "ra": 1, "dec": 1}).status_code == 400
    assert client.get("/api/v2/resolve", params={"q": "   "}).status_code == 400
    r = client.get("/api/v2/resolve", params={"q": "08h55m10.831s −07°14′42.53″"}).json()
    assert r["ra"] == pytest.approx(133.7951292, abs=1e-6) and "typed" in r["source"]
    r = client.get("/api/v2/resolve", params={"q": "barnards star"}).json()
    assert r["pmdec"] == 10362.394 and r["kind"] == "star"
