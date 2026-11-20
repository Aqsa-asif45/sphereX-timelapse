"""Offline tests: the cutout maths and the endpoints' input checks (no network)."""

import asyncio
import json

import numpy as np
import pytest
from astropy.wcs import WCS
from fastapi.testclient import TestClient

from app.main import app
from app.services import fitsio
from app.services.cutouts import blank_impossible, grid_sky, nearest, resample, resample_exact

KEY = "dr1/level2/2025W33_2C/l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits"


@pytest.mark.parametrize("x0, x1, y0, y1", [(10, 50, 100, 140), (0, 2039, 5, 7), (1990, 2039, 0, 200), (7, 7, 9, 9)])
def test_read_block_cuts_the_right_pixels(monkeypatch, x0, x1, y0, y1):
    """A fake file where pixel (x, y) holds y * 10000 + x: any slicing mistake shows up."""
    start = 1000  # where the layer's data starts in the fake file
    calls = []

    async def fake_read_range(client, sem, key, rng):
        a, b = (int(v) for v in rng.removeprefix("bytes=").split("-"))
        k = np.arange((a - start) // 4, (b - start) // 4 + 1)
        calls.append(rng)
        return ((k // 2040) * 10000 + k % 2040).astype(">f4").tobytes(), 0

    monkeypatch.setattr(fitsio, "read_range", fake_read_range)
    got = asyncio.run(fitsio.read_block(None, None, KEY, start, x0, x1, y0, y1))
    ys, xs = np.mgrid[y0 : y1 + 1, x0 : x1 + 1]
    assert np.array_equal(got, ys * 10000 + xs)
    assert len(calls) == -(-(y1 - y0 + 1) // fitsio.ROWS_PER_READ)  # one request per 64 rows


def test_grid_is_centred_north_up_east_left():
    ra, dec = grid_sky(269.4, 4.7, 39, 6.15 / 3600)
    assert ra[19, 19] == pytest.approx(269.4) and dec[19, 19] == pytest.approx(4.7)
    assert dec[0, 19] > dec[38, 19]  # row 0 is north
    assert ra[19, 0] > ra[19, 38]  # column 0 is east (larger RA)
    assert (dec[0, 19] - dec[38, 19]) * 3600 == pytest.approx(38 * 6.15, rel=1e-4)


def test_grid_corners_surround_the_centres():
    ra, dec = grid_sky(269.4, 4.7, 39, 6.15 / 3600)
    cra, cdec = grid_sky(269.4, 4.7, 39, 6.15 / 3600, corners=True)
    assert cra.shape == (40, 40)
    assert (cdec[0, 0] + cdec[1, 1]) / 2 == pytest.approx(dec[0, 0], abs=1e-7)  # 1e-7 deg = 0.0004"
    assert (cra[0, 0] + cra[1, 1]) / 2 == pytest.approx(ra[0, 0], abs=1e-7)


def _aligned(n, shift=0.0):
    """Corner positions of an output grid lying exactly on a detector grid (shifted by `shift` pixels)."""
    j, i = np.mgrid[0 : n + 1, 0 : n + 1]
    return i - 0.5 + shift, n - 0.5 - j + shift  # our row 0 (north) is the detector's top row


def test_area_resample_copies_aligned_pixels_and_keeps_constants():
    block = np.arange(25, dtype=float).reshape(5, 5)
    cx, cy = _aligned(5)
    assert np.allclose(resample(block, cx, cy), block[::-1])  # same grid: the same values, north up
    flat = np.full((10, 10), 7.5)
    cx, cy = _aligned(8, 0.37)
    assert np.allclose(resample(flat, cx, cy), 7.5)


def test_area_resample_never_rings_and_keeps_blanks_blank():
    block = np.zeros((9, 9))
    block[4, 4] = 1000.0  # a sharp star, one pixel wide (Lanczos rang to large negatives here)
    cx, cy = _aligned(9, 0.4)
    out = resample(block, cx, cy)
    assert np.nanmin(out) >= 0 and np.nanmax(out) <= 1000
    block[4, 4] = np.nan
    cx, cy = _aligned(9)
    out = resample(block, cx, cy)
    assert np.isnan(out[4, 4]) and np.isfinite(out[4, 3])  # a blank stays blank; neighbours are not touched
    cx, cy = _aligned(9, 20.0)
    assert np.isnan(resample(block, cx, cy)).all()  # off the block


def test_impossible_pixels_are_blanked_and_real_ones_kept():
    rng = np.random.default_rng(1)
    block = 10 + rng.normal(0, 1, (40, 40))  # sky at 10 MJy/sr, noise 1
    block[5, 5] = -1000.0  # a dead pixel far below the sky
    block[20, 20] = 5000.0  # a bright star: must stay
    block[30, 30] = 7.0  # 3 sigma low: ordinary noise, must stay
    out = blank_impossible(block)
    assert np.isnan(out[5, 5]) and out[20, 20] == 5000.0 and out[30, 30] == 7.0
    assert np.isfinite(out).sum() == 40 * 40 - 1


def _tan(ra, dec, n, s):
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2] * 2
    w.wcs.cdelt = [-s / 3600, s / 3600]
    return w


def test_exact_resample_on_the_same_grid_is_a_copy_north_up():
    n, s = 7, 6.15
    block = np.arange(49, dtype=float).reshape(7, 7)  # FITS order: row 0 is south
    cx, cy = _aligned(n)
    out = resample_exact(block, _tan(30.0, 10.0, n, s), 30.0, 10.0, n, s, cx, cy)
    assert np.allclose(out, block[::-1], atol=1e-6)


def test_exact_resample_never_rings_and_keeps_blanks_blank():
    n, s = 9, 6.15
    block = np.zeros((9, 9))
    block[4, 4] = 1000.0
    cx, cy = _aligned(n, 0.4)
    # the output grid is the block grid moved 0.4 pixel north-east-ish: overlaps are partial everywhere
    out = resample_exact(block, _tan(30.0, 10.0, n, s), 30.0 - 0.4 * s / 3600, 10.0 + 0.4 * s / 3600, n, s, cx, cy)
    assert np.nanmin(out) >= -1e-9 and np.nanmax(out) <= 1000
    assert np.nansum(out) == pytest.approx(1000, rel=0.02)  # the star's light is conserved
    block[4, 4] = np.nan
    cx, cy = _aligned(n)
    out = resample_exact(block, _tan(30.0, 10.0, n, s), 30.0, 10.0, n, s, cx, cy)
    assert np.isnan(out[4, 4]) and out[4, 3] == pytest.approx(0, abs=1e-9)


def test_nearest_for_flags():
    flags = np.arange(16, dtype=np.int32).reshape(4, 4)
    got = nearest(flags, np.array([[1.4, 2.6, 9.0]]), np.array([[0.2, 3.0, 0.0]]), -1, np.int32)
    assert got.tolist() == [[1, 15, -1]]


def test_endpoints_check_their_input():
    with TestClient(app) as c:
        base = {"ra": 269.4, "dec": 4.7, "n": 39}
        assert c.get("/api/cutouts/one", params={**base, "id": "../../etc/passwd"}).status_code == 400
        assert c.get("/api/cutouts/one", params={**base, "id": KEY, "n": 5000}).status_code == 422
        assert c.get("/api/pixels", params={"id": KEY, "x": 0, "y": 5}).status_code == 422
        big = json.dumps({**base, "ids": ["x" * 300] * 400})
        assert c.post("/api/cutouts/batch", content=big).status_code == 413
        assert c.post("/api/cutouts/batch", content="{not json").status_code == 422
        assert c.post("/api/cutouts/batch", json={**base, "ids": [KEY], "n": 2}).status_code == 422
        assert c.get("/api/cutouts/batch").status_code == 405
