"""Live cutout tests against NASA's files, IRSA's own cutout service and the old site's cutouts.
Skip them offline with: pytest -m "not network"."""

import asyncio
import io
import json
import struct
import time
from pathlib import Path

import httpx
import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS
from fastapi.testclient import TestClient

from app.config import IRSA_FILES
from app.main import app
from app.services.fitsio import file_header, hdu_layout, read_flag_block
from app.services.frames import position_at

pytestmark = pytest.mark.network

FIX = Path(__file__).parent / "fixtures" / "old_cutouts"
OLD = json.loads((FIX / "index.json").read_text())  # 3 Barnard's Star cutouts saved from the old site
N = OLD["n"]


def _irsa_cutout(key: str, ra: float, dec: float, size_deg: float = 0.04) -> fits.HDUList:
    url = f"{IRSA_FILES}{key}?center={ra:.7f},{dec:.7f}d&size={size_deg}"
    for attempt in range(4):  # IRSA's cutout service is sometimes briefly unavailable (503)
        try:
            r = httpx.get(url, timeout=120, follow_redirects=True)
            r.raise_for_status()
            return fits.open(io.BytesIO(r.content))
        except httpx.HTTPError:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    raise AssertionError("not reached")


def _offset(key: str, cut: fits.Header) -> tuple[int, int]:
    """How far IRSA's cutout is shifted from the original file (from the two CRPIX values)."""

    async def header():
        async with httpx.AsyncClient() as c:
            return await file_header(c, asyncio.Semaphore(4), key)

    orig = fits.Header.fromstring(asyncio.run(header())["image_header"])
    return round(orig["CRPIX1"] - cut["CRPIX1"]), round(orig["CRPIX2"] - cut["CRPIX2"])


@pytest.mark.parametrize("frame", OLD["frames"], ids=lambda f: f["key"].split("/")[0] + "-D" + f["key"].split("/")[4])
def test_cutout_matches_the_old_site(frame):
    """Done-when check for Phase 2: same exposure, same grid -> the same image as the old site."""
    params = {"id": frame["key"], "ra": OLD["centre_ra"], "dec": OLD["centre_dec"], "n": N, "scale": 6.15}
    with TestClient(app) as c:
        r = c.get("/api/cutouts/one", params=params)
    assert r.status_code == 200
    new = np.frombuffer(r.content, "<f4").reshape(N, N)
    old = np.fromfile(FIX / frame["file"], "<f4").reshape(N, N)
    assert np.array_equal(np.isnan(new), np.isnan(old))  # the same pixels are blank
    ok = np.isfinite(new)
    diff = np.abs(new - old)[ok]
    noise = 1.4826 * np.median(np.abs(old[ok] - np.median(old[ok])))
    assert np.median(diff) < 0.01 * noise  # typical pixel: identical to within 1 % of the noise
    assert diff.max() < 0.005 * np.nanmax(old)  # worst pixel (on the star): within 0.5 % of the peak
    assert np.corrcoef(new[ok], old[ok])[0, 1] > 0.9999


@pytest.mark.slow
def test_raw_pixels_and_flags_equal_irsa_cutout_service():
    frame = OLD["frames"][0]
    with TestClient(app) as c:
        f = next(x for x in c.get("/api/observations", params=_barnard()).json()["frames"] if x["id"] == frame["key"])
        cut = _irsa_cutout(f["id"], OLD["centre_ra"], OLD["centre_dec"])
        dx, dy = _offset(f["id"], cut["IMAGE"].header)
        # a 21 x 21 window whose top-left corner is the cutout's first pixel
        got = c.get("/api/pixels", params={"id": f["id"], "x": dx + 11, "y": dy + 11, "r": 10}).json()
    assert (got["x0"], got["y0"]) == (dx + 1, dy + 1)
    ours = np.array(got["values"], dtype=float)
    theirs = np.asarray(cut["IMAGE"].data[:21, :21], dtype=float)
    assert np.array_equal(ours, theirs, equal_nan=True)  # bit for bit

    async def flags():
        async with httpx.AsyncClient() as c:
            sem = asyncio.Semaphore(16)
            lay = await hdu_layout(c, sem, f["id"])
            return lay, await read_flag_block(c, sem, f["id"], lay["flags"], dx, dx + 20, dy, dy + 20)

    lay, our_flags = asyncio.run(flags())
    assert lay["flags"]["compressed"]  # DR1: RICE_1 tiles, decoded by us
    assert np.array_equal(our_flags, np.asarray(cut["FLAGS"].data[:21, :21], dtype=np.int32))
    assert lay["flags"]["names"]["21"] == "SOURCE"  # bit names come from the file's own MSKN cards


@pytest.mark.slow
def test_target_pixel_agrees_with_irsa_header():
    """Our target pixel (from AWS headers) vs Astropy on IRSA's own cutout header: within 0.004 px."""
    with TestClient(app) as c:
        frames = c.get("/api/observations", params=_barnard()).json()["frames"]
    for f in [x for x in frames if x["id"] in {o["key"] for o in OLD["frames"]}]:
        cut = _irsa_cutout(f["id"], OLD["centre_ra"], OLD["centre_dec"])
        dx, dy = _offset(f["id"], cut["IMAGE"].header)
        ra, dec = position_at(269.4520769586187, 4.6933649665767, 51544.5, -801.551, 10362.394, f["mjd"])
        cx, cy = WCS(cut["IMAGE"].header).all_world2pix(ra, dec, 1)  # 1-based, in the cutout
        assert abs(cx + dx - f["x"]) < 0.004 and abs(cy + dy - f["y"]) < 0.004


def test_batch_records_equal_single_cutouts():
    ids = [f["key"] for f in OLD["frames"]] + ["dr1/level2/not/a/real/file.fits"]
    body = {"ids": ids, "ra": OLD["centre_ra"], "dec": OLD["centre_dec"], "n": N, "scale": 6.15, "flags": True}
    with TestClient(app) as c:
        r = c.post("/api/cutouts/batch", json=body)
        singles = {k: c.get("/api/cutouts/one", params={**body, "id": k, "flags": True}).content for k in ids[:3]}
    buf, off, got = r.content, 0, {}
    while off < len(buf):
        idlen, status, size = struct.unpack_from("<HBI", buf, off)
        key = buf[off + 7 : off + 7 + idlen].decode()
        got[key] = (status, buf[off + 7 + idlen : off + 7 + idlen + size])
        off += 7 + idlen + size
    assert set(got) == set(ids)
    assert got[ids[-1]] == (1, b"")  # a bad id is reported as failed, never skipped
    for k in ids[:3]:
        assert got[k] == (0, singles[k])  # byte-identical to /api/cutouts/one


def _barnard() -> dict:
    return {"ra": 269.4520769586187, "dec": 4.6933649665767, "epoch_mjd": 51544.5, "pmra": -801.551, "pmdec": 10362.394}
