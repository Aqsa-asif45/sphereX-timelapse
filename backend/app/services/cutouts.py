"""Cutouts: a small north-up, east-left image of one exposure on a grid shared by every exposure,
so exposures can be blinked, subtracted and stacked.

How one cutout is made:
1. Build the output grid: n x n pixels of `scale` arcsec, centred on (ra, dec), north up, east left.
2. Find where every grid pixel falls on the detector (the file's own TAN-SIP sky WCS, via Astropy).
3. Read only those detector rows from AWS (plus 3 pixels around them for the filter).
4. Resample with a Lanczos-3 filter, the same as the old site. A blank source pixel stays blank.
5. Flags and variance (if asked): the value of the nearest detector pixel. -1 = no flag information.
If AWS cannot be read, the same block comes from IRSA's cutout service instead.

Binary payload (little-endian): n*n float32 image, then n*n int32 flags (if asked),
then n*n float32 variance (if asked). Blank pixels are NaN.
"""

import asyncio
import hashlib
import io

import httpx
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from ..config import IRSA_FILES, NPIX, settings
from .archive import KEY_RE
from .fitsio import FileReadError, file_header, hdu_layout, read_block, read_flag_block, sky_wcs

CUTOUT_VERSION = "c1"
_jobs: dict[str, asyncio.Task] = {}  # cutouts being made right now: a second request waits for the first


def grid_sky(ra0: float, dec0: float, n: int, scale_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """RA and Dec (degrees) of every pixel of the n x n output grid. Row 0 is the top (north)."""
    c = (n - 1) / 2
    idx = np.arange(n)
    xi = np.radians(-(idx - c) * scale_deg)  # east is left, so x grows to the west
    eta = np.radians((c - idx) * scale_deg)  # north is up, so rows grow to the south
    x, y = np.meshgrid(xi, eta)
    d0 = np.radians(dec0)
    denom = np.cos(d0) - y * np.sin(d0)  # gnomonic (tangent-plane) projection, inverted
    ra = (ra0 + np.degrees(np.arctan2(x, denom))) % 360
    dec = np.degrees(np.arctan2(np.sin(d0) + y * np.cos(d0), np.hypot(x, denom)))
    return ra, dec


def lanczos3(t: np.ndarray) -> np.ndarray:
    t = np.asarray(t, dtype=np.float64)
    out = np.zeros_like(t)
    inside = np.abs(t) < 3
    pt = np.pi * t[inside]
    with np.errstate(invalid="ignore", divide="ignore"):
        out[inside] = np.where(pt == 0, 1.0, 3 * np.sin(pt) * np.sin(pt / 3) / (pt * pt))
    return out


def _inside(block: np.ndarray, fx: np.ndarray, fy: np.ndarray) -> np.ndarray:
    h, w = block.shape
    return np.isfinite(fx) & np.isfinite(fy) & (fx >= 0) & (fy >= 0) & (fx <= w - 1) & (fy <= h - 1)


def resample(block: np.ndarray, fx: np.ndarray, fy: np.ndarray) -> np.ndarray:
    """Lanczos-3 value at block positions (fx, fy) (0-based). Outside the block, or on a blank pixel: NaN."""
    h, w = block.shape
    out = np.full(fx.shape, np.nan, dtype=np.float32)
    ok = _inside(block, fx, fy)
    fx, fy = fx[ok], fy[ok]
    nearest = block[np.rint(fy).astype(int), np.rint(fx).astype(int)].astype(np.float64)
    keep = np.isfinite(nearest)  # a blank (saturated or missing) source pixel stays blank: never invent data
    fx, fy, nearest = fx[keep], fy[keep], nearest[keep]
    k = np.arange(-2, 4)  # the 6 taps around each point
    ix = np.floor(fx)[:, None] + k  # (N, 6)
    iy = np.floor(fy)[:, None] + k
    wx = lanczos3(fx[:, None] - ix) * ((ix >= 0) & (ix < w))
    wy = lanczos3(fy[:, None] - iy) * ((iy >= 0) & (iy < h))
    vals = block[np.clip(iy, 0, h - 1).astype(int)[:, :, None], np.clip(ix, 0, w - 1).astype(int)[:, None, :]]
    wts = wy[:, :, None] * wx[:, None, :]
    good = np.isfinite(vals) & (wts != 0)
    s = np.where(good, wts * vals, 0).sum(axis=(1, 2))
    ws = np.where(good, wts, 0).sum(axis=(1, 2))
    res = np.where(ws > 0.2, s / np.where(ws > 0.2, ws, 1), nearest)
    idx = np.flatnonzero(ok)[keep]
    out.ravel()[idx] = res
    return out


def nearest(block: np.ndarray, fx: np.ndarray, fy: np.ndarray, fill, dtype) -> np.ndarray:
    out = np.full(fx.shape, fill, dtype=dtype)
    ok = _inside(block, fx, fy)
    out[ok] = block[np.rint(fy[ok]).astype(int), np.rint(fx[ok]).astype(int)]
    return out


def _payload(n, img, flags, var) -> bytes:
    parts = [img.astype("<f4").reshape(n, n).tobytes()]
    if flags is not None:
        parts.append(flags.astype("<i4").reshape(n, n).tobytes())
    if var is not None:
        parts.append(var.astype("<f4").reshape(n, n).tobytes())
    return b"".join(parts)


def _grid_pixels(wcs: WCS, ra: float, dec: float, n: int, scale_arcsec: float):
    gra, gdec = grid_sky(ra, dec, n, scale_arcsec / 3600)
    px, py = wcs.all_world2pix(gra.ravel(), gdec.ravel(), 0, tolerance=1e-7, quiet=True)  # 0-based
    return px.reshape(n, n), py.reshape(n, n)


async def _from_aws(client, sem, key, ra, dec, n, scale_arcsec, want_flags, want_var) -> bytes:
    info = await file_header(client, sem, key)
    px, py = _grid_pixels(sky_wcs(info["image_header"]), ra, dec, n, scale_arcsec)
    on = np.isfinite(px) & np.isfinite(py) & (px > -4) & (py > -4) & (px < NPIX + 3) & (py < NPIX + 3)
    if not on.any():  # the grid misses this detector entirely
        img = np.full((n, n), np.nan, np.float32)
        return _payload(n, img, np.full((n, n), -1) if want_flags else None, img if want_var else None)
    x0 = max(0, int(np.floor(px[on].min())) - 3)
    x1 = min(NPIX - 1, int(np.ceil(px[on].max())) + 3)
    y0 = max(0, int(np.floor(py[on].min())) - 3)
    y1 = min(NPIX - 1, int(np.ceil(py[on].max())) + 3)
    layout = await hdu_layout(client, sem, key) if want_flags or want_var else None
    jobs = [read_block(client, sem, key, info["data_start"], x0, x1, y0, y1)]  # made only once nothing can fail
    if layout:
        if want_flags:
            jobs.append(read_flag_block(client, sem, key, layout["flags"], x0, x1, y0, y1))
        if want_var:
            jobs.append(read_block(client, sem, key, layout["variance"]["data_start"], x0, x1, y0, y1))
    blocks = await asyncio.gather(*jobs)
    fx, fy = px - x0, py - y0

    def work():
        img = resample(blocks[0].astype(np.float64), fx, fy)
        fl = nearest(blocks[1], fx, fy, -1, np.int32) if want_flags else None
        var = nearest(blocks[-1], fx, fy, np.nan, np.float32) if want_var else None
        return _payload(n, img, fl, var)

    return await asyncio.to_thread(work)


async def _from_irsa(client, key, ra, dec, n, scale_arcsec, want_flags, want_var) -> bytes:
    """Fallback: IRSA's cutout service returns a small piece of the original file with all its layers."""
    size = min(0.5, n * scale_arcsec / 3600 * 1.5 + 20 * 6.15 / 3600)
    url = f"{IRSA_FILES}{key}?center={ra:.7f},{dec:.7f}d&size={size:.5f}"
    try:
        r = await client.get(url, timeout=120)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise FileReadError(f"IRSA cutout service failed ({type(e).__name__})") from e
    if not r.content.startswith(b"SIMPLE"):
        raise FileReadError("IRSA cutout service did not return a FITS file")

    def work():
        with fits.open(io.BytesIO(r.content)) as hd:
            px, py = _grid_pixels(WCS(hd["IMAGE"].header), ra, dec, n, scale_arcsec)
            img = resample(np.asarray(hd["IMAGE"].data, dtype=np.float64), px, py)
            fl = nearest(np.asarray(hd["FLAGS"].data, np.int32), px, py, -1, np.int32) if want_flags else None
            var = nearest(np.asarray(hd["VARIANCE"].data, np.float32), px, py, np.nan, np.float32) if want_var else None
        return _payload(n, img, fl, var)

    return await asyncio.to_thread(work)


async def _make(client, sem, key, ra, dec, n, scale_arcsec, want_flags, want_var, path) -> bytes:
    try:
        data = await _from_aws(client, sem, key, ra, dec, n, scale_arcsec, want_flags, want_var)
    except FileReadError:
        data = await _from_irsa(client, key, ra, dec, n, scale_arcsec, want_flags, want_var)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


async def get_cutout(
    client,
    sem,
    key: str,
    ra: float,
    dec: float,
    n: int,
    scale_arcsec: float,
    flags: bool = False,
    variance: bool = False,
) -> bytes:
    """The cutout as binary payload: from the disk cache, from a job already running, or made now."""
    if not KEY_RE.match(key):
        raise ValueError("Not a SPHEREx spectral image id.")
    raw = f"{CUTOUT_VERSION}|{key}|{ra:.6f}|{dec:.6f}|{n}|{scale_arcsec:.4f}|{int(flags)}|{int(variance)}"
    path = settings.cache_dir / "cutouts" / (hashlib.sha1(raw.encode()).hexdigest() + ".bin")
    if path.exists():
        return path.read_bytes()
    job = _jobs.get(raw)
    if job is None or job.done():
        job = asyncio.ensure_future(_make(client, sem, key, ra, dec, n, scale_arcsec, flags, variance, path))
        _jobs[raw] = job
        job.add_done_callback(lambda _: _jobs.pop(raw, None))
    return await asyncio.shield(job)


async def raw_pixels(client, sem, key: str, x: int, y: int, r: int) -> dict:
    """Raw detector values around FITS pixel (x, y), 1-based, no resampling: for checking the data."""
    if not KEY_RE.match(key):
        raise ValueError("Not a SPHEREx spectral image id.")
    info = await file_header(client, sem, key)
    x0, x1 = max(1, x - r), min(NPIX, x + r)
    y0, y1 = max(1, y - r), min(NPIX, y + r)
    block = await read_block(client, sem, key, info["data_start"], x0 - 1, x1 - 1, y0 - 1, y1 - 1)
    values = [[None if not np.isfinite(v) else float(v) for v in row] for row in block]
    return {"id": key, "x0": x0, "y0": y0, "values": values, "unit": "MJy/sr"}
