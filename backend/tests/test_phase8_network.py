"""Phase 8 live checks: the Gaia overlay rows equal ESA's own archive, and flag names come from the file.
Skip them offline with: pytest -m "not network"."""

import csv
import io

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.frames import position_at

pytestmark = pytest.mark.network

ESA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
# Barnard's Star where the Explore page centres it (end of 2025), and the radius it asks for at 4′
BARNARD = position_at(269.4520769586187, 4.6933649665767, 51544.5, -801.551, 10362.394, 61040)
R_4ARCMIN = 4 / 60 * 0.75


def _esa_rows(ra: float, dec: float, r: float) -> list[dict]:
    """The same stars asked of ESA directly (own query and parsing, not the app's code), as ESA sends them."""
    q = (
        "SELECT source_id, ra, dec, pmra, pmdec, phot_g_mean_mag FROM gaiadr3.gaia_source "
        f"WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {r:.5f})) = 1 "
        "AND phot_g_mean_mag < 20"
    )
    for attempt in range(3):  # ESA's archive sometimes answers 408 when busy
        res = httpx.post(ESA_TAP, data={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": q}, timeout=120)
        if res.status_code != 408 or attempt == 2:
            break
    res.raise_for_status()
    return list(csv.DictReader(io.StringIO(res.text.strip())))


def _f(x: str):
    return float(x) if x not in ("", None) else None


def test_gaia_overlay_rows_equal_esa_archive(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "cache_dir", tmp_path)  # a fresh answer, not a cached one
    ra, dec = BARNARD
    with TestClient(app) as c:
        ours = c.get("/api/catalogs/gaia", params={"ra": round(ra, 6), "dec": round(dec, 6), "r": R_4ARCMIN}).json()
    theirs = _esa_rows(round(ra, 6), round(dec, 6), R_4ARCMIN)
    assert ours["source"] == "Gaia DR3 via ESA" and ours["epoch_mjd"] == 57388.5  # J2016.0
    key = lambda r: (r["ra"], r["dec"], r["pmra"], r["pmdec"], r["mag"])  # noqa: E731
    esa = [
        {
            "ra": _f(x["ra"]),
            "dec": _f(x["dec"]),
            "pmra": _f(x["pmra"]),
            "pmdec": _f(x["pmdec"]),
            "mag": _f(x["phot_g_mean_mag"]),
        }
        for x in theirs
    ]
    assert len(esa) > 10
    assert sorted(map(key, ours["rows"]), key=str) == sorted(map(key, esa), key=str)  # identical rows, every column
    # Barnard's Star itself is there, with its famous motion (~10.4″/yr north)
    fast = [r for r in ours["rows"] if r["pmdec"] and r["pmdec"] > 10000]
    assert len(fast) == 1 and 10300 < fast[0]["pmdec"] < 10400


def test_flag_names_come_from_the_file():
    with TestClient(app) as c:
        f = c.get("/api/observations", params={"ra": round(BARNARD[0], 6), "dec": round(BARNARD[1], 6)}).json()
        dr1 = next(x for x in f["frames"] if x["release"] == "dr1")
        got = c.get("/api/flags", params={"id": dr1["id"]}).json()
    assert got["compressed"] is True  # DR1 FLAGS are RICE_1 tile-compressed
    assert got["names"]["21"] == "SOURCE" and got["names"]["0"] == "TRANSIENT"
