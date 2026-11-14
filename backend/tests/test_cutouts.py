"""Offline tests: the cutout maths and the endpoints' input checks (no network)."""

import asyncio
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import fitsio
from app.services.cutouts import grid_sky, lanczos3, nearest, resample

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


def test_lanczos3_kernel():
    assert lanczos3(np.array([0.0]))[0] == 1
    assert np.allclose(lanczos3(np.array([1.0, 2.0, -1.0, 3.0, 3.5])), 0, atol=1e-12)


def test_resample_keeps_exact_pixels_and_constants():
    block = np.arange(100, dtype=float).reshape(10, 10)
    fx, fy = np.array([[4.0, 5.0]]), np.array([[6.0, 3.0]])
    assert np.allclose(resample(block, fx, fy), [[64.0, 35.0]])  # on a pixel centre: that pixel's value
    flat = np.full((10, 10), 7.5)
    assert np.allclose(resample(flat, np.array([[4.3]]), np.array([[5.7]])), 7.5, atol=1e-5)


def test_blank_stays_blank_and_outside_is_nan():
    block = np.ones((10, 10))
    block[5, 5] = np.nan
    out = resample(block, np.array([[5.2, 2.0, 12.0]]), np.array([[4.9, 2.0, 2.0]]))
    assert np.isnan(out[0, 0])  # nearest source pixel is blank: never filled in
    assert out[0, 1] == pytest.approx(1.0)
    assert np.isnan(out[0, 2])  # off the block


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
