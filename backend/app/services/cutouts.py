"""Cutouts: a small north-up, east-left image of one exposure on a grid shared by every exposure,
so exposures can be blinked, subtracted and stacked.

How one cutout is made:
1. Build the output grid: n x n pixels of `scale` arcsec, centred on (ra, dec), north up, east left.
2. Find where every grid pixel falls on the detector (the file's own TAN-SIP sky WCS, via Astropy).
3. Read only those detector rows from AWS (plus 3 pixels around them).
4. Resample by area: each output pixel is the mean of the detector pixels it covers (4 x 4 sub-samples per
   output pixel, mapped through the file's WCS). This never creates values that are not in the data:
   the Lanczos-3 filter used before rang to -300...-900 sigma next to bright stars, because SPHEREx stars
   are only about one pixel wide (checked against reproject_exact; see docs/DECISIONS.md).
   An output pixel is blank if its centre falls on a blank detector pixel or if less than half of it is
   covered by real pixels: nothing is filled in.
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
from reproject import reproject_exact

from ..config import IRSA_FILES, NPIX, settings
from .archive import KEY_RE
from .fitsio import FileReadError, file_header, hdu_layout, read_block, read_flag_block, sky_wcs

CUTOUT_VERSION = "c3"  # c3: impossible (dead/cold/cosmic-ray) pixels blanked; c2: area resampling; c1: Lanczos-3
SUB = 4  # sub-samples per output pixel side for the area resampling
# A pixel this far below the local sky cannot be light from the sky (zodiacal light is not subtracted, so the
# sky is always positive). In NASA's files 93% of them (80 of 86 checked) carry NASA's own "bad" flags:
# NONFUNC (dead), COLD, TRANSIENT (cosmic ray) or SUR_ERROR. They reached -1129 sigma and showed as black specks.
IMPOSSIBLE_SIGMA = 5.0


def blank_impossible(block: np.ndarray) -> np.ndarray:
    """The block with pixels more than IMPOSSIBLE_SIGMA below the local sky (robust median and MAD) set blank."""
    v = block[np.isfinite(block)]
    if v.size < 20:
        return block
    med = np.median(v)
    sig = 1.4826 * np.median(np.abs(v - med))
    if not sig > 0:
        return block
    with np.errstate(invalid="ignore"):
        return np.where(block < med - IMPOSSIBLE_SIGMA * sig, np.nan, block)
_jobs: dict[str, asyncio.Task] = {}  # cutouts being made right now: a second request waits for the first


def grid_sky(
    ra0: float, dec0: float, n: int, scale_deg: float, corners: bool = False
) -> tuple[np.ndarray, np.ndarray]:
    """RA and Dec (degrees) of every pixel centre of the n x n output grid (row 0 is the top, north),
    or with corners=True of the (n+1) x (n+1) pixel corners."""
    c = (n - 1) / 2
    idx = np.arange(n + 1) - 0.5 if corners else np.arange(n)
    xi = np.radians(-(idx - c) * scale_deg)  # east is left, so x grows to the west
    eta = np.radians((c - idx) * scale_deg)  # north is up, so rows grow to the south
    x, y = np.meshgrid(xi, eta)
    d0 = np.radians(dec0)
    denom = np.cos(d0) - y * np.sin(d0)  # gnomonic (tangent-plane) projection, inverted
    ra = (ra0 + np.degrees(np.arctan2(x, denom))) % 360
    dec = np.degrees(np.arctan2(np.sin(d0) + y * np.cos(d0), np.hypot(x, denom)))
    return ra, dec


def _inside(block: np.ndarray, fx: np.ndarray, fy: np.ndarray) -> np.ndarray:
    h, w = block.shape
    return np.isfinite(fx) & np.isfinite(fy) & (fx >= 0) & (fy >= 0) & (fx <= w - 1) & (fy <= h - 1)


def _sample(block: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """The detector pixel under each point (0-based positions; pixel p spans p-0.5..p+0.5). Outside: NaN."""
    h, w = block.shape
    out = np.full(x.shape, np.nan)
    ix, iy = np.rint(x), np.rint(y)
    ok = np.isfinite(ix) & np.isfinite(iy) & (ix >= 0) & (iy >= 0) & (ix < w) & (iy < h)
    out[ok] = block[iy[ok].astype(int), ix[ok].astype(int)]
    return out


def resample(block: np.ndarray, cx: np.ndarray, cy: np.ndarray, sub: int = SUB) -> np.ndarray:
    """Area resampling. cx, cy: block positions (0-based) of the (n+1) x (n+1) output pixel corners.

    Each output pixel is the mean of sub x sub points spread evenly over it (each point takes the detector
    pixel it lands on), i.e. the area-weighted mean of the detector pixels it covers. Blank if its centre
    lands on a blank pixel or if fewer than half the points land on real pixels.
    """
    x00, x10, x01, x11 = cx[:-1, :-1], cx[:-1, 1:], cx[1:, :-1], cx[1:, 1:]
    y00, y10, y01, y11 = cy[:-1, :-1], cy[:-1, 1:], cy[1:, :-1], cy[1:, 1:]
    total = np.zeros(x00.shape)
    count = np.zeros(x00.shape)
    for a in range(sub):
        v = (a + 0.5) / sub
        for b in range(sub):
            u = (b + 0.5) / sub
            w00, w10, w01, w11 = (1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v
            x = w00 * x00 + w10 * x10 + w01 * x01 + w11 * x11
            y = w00 * y00 + w10 * y10 + w01 * y01 + w11 * y11
            val = _sample(block, x, y)
            good = np.isfinite(val)
            total += np.where(good, val, 0.0)
            count += good
    centre = _sample(block, (x00 + x10 + x01 + x11) / 4, (y00 + y10 + y01 + y11) / 4)
    keep = np.isfinite(centre) & (count >= sub * sub / 2)  # never fill in a blank or mostly-blank pixel
    return np.where(keep, total / np.maximum(count, 1), np.nan).astype(np.float32)


EXACT_MAX_N = 99  # up to a 10' field: exact pixel overlap (reproject_exact, ~20 ms); larger: resample() above


def resample_exact(block: np.ndarray, wcs_block: WCS, ra: float, dec: float, n: int, scale_arcsec: float,
                   cx: np.ndarray, cy: np.ndarray) -> np.ndarray:
    """Exact area-weighted mean of the detector pixels under each output pixel (reproject_exact, which
    intersects the true pixel outlines on the sky). Blank pixels carry no weight; an output pixel is blank
    if its centre lands on a blank pixel or if less than half of it is covered by real pixels."""
    g = WCS(naxis=2)
    g.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    g.wcs.crval = [ra, dec]
    g.wcs.crpix = [(n + 1) / 2] * 2
    g.wcs.cdelt = [-scale_arcsec / 3600, scale_arcsec / 3600]  # east left, north up
    real = np.isfinite(block)
    a = reproject_exact((np.where(real, block, 0.0), wcs_block), g, shape_out=(n, n), return_footprint=False)
    b = reproject_exact((real.astype(float), wcs_block), g, shape_out=(n, n), return_footprint=False)
    a, b = a[::-1], b[::-1]  # FITS rows run south to north; ours start at the top (north)
    centre = _sample(block, (cx[:-1, :-1] + cx[:-1, 1:] + cx[1:, :-1] + cx[1:, 1:]) / 4,
                     (cy[:-1, :-1] + cy[:-1, 1:] + cy[1:, :-1] + cy[1:, 1:]) / 4)
    keep = np.isfinite(centre) & np.isfinite(b) & (b >= 0.5)
    return np.where(keep, a / np.where(b > 0, b, 1), np.nan).astype(np.float32)


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


def _grid_pixels(wcs: WCS, ra: float, dec: float, n: int, scale_arcsec: float, corners: bool = False):
    """Detector positions (0-based) of the output pixel centres (n x n) or corners ((n+1) x (n+1))."""
    gra, gdec = grid_sky(ra, dec, n, scale_arcsec / 3600, corners)
    px, py = wcs.all_world2pix(gra.ravel(), gdec.ravel(), 0, tolerance=1e-7, quiet=True)  # 0-based
    return px.reshape(gra.shape), py.reshape(gra.shape)


async def _from_aws(client, sem, key, ra, dec, n, scale_arcsec, want_flags, want_var) -> bytes:
    info = await file_header(client, sem, key)
    wcs = sky_wcs(info["image_header"])
    qx, qy = _grid_pixels(wcs, ra, dec, n, scale_arcsec, corners=True)  # for the image (area resampling)
    on = np.isfinite(qx) & np.isfinite(qy) & (qx > -2) & (qy > -2) & (qx < NPIX + 1) & (qy < NPIX + 1)
    if not on.any():  # the grid misses this detector entirely
        img = np.full((n, n), np.nan, np.float32)
        return _payload(n, img, np.full((n, n), -1) if want_flags else None, img if want_var else None)
    px, py = _grid_pixels(wcs, ra, dec, n, scale_arcsec)  # pixel centres: for flags and variance
    x0 = max(0, int(np.floor(qx[on].min())) - 1)
    x1 = min(NPIX - 1, int(np.ceil(qx[on].max())) + 1)
    y0 = max(0, int(np.floor(qy[on].min())) - 1)
    y1 = min(NPIX - 1, int(np.ceil(qy[on].max())) + 1)
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
        b = blank_impossible(blocks[0].astype(np.float64))
        if n <= EXACT_MAX_N:
            img = resample_exact(b, wcs[y0 : y1 + 1, x0 : x1 + 1], ra, dec, n, scale_arcsec, qx - x0, qy - y0)
        else:
            img = resample(b, qx - x0, qy - y0)
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
            wcs = WCS(hd["IMAGE"].header)
            px, py = _grid_pixels(wcs, ra, dec, n, scale_arcsec)
            qx, qy = _grid_pixels(wcs, ra, dec, n, scale_arcsec, corners=True)
            data = blank_impossible(np.asarray(hd["IMAGE"].data, dtype=np.float64))
            if n <= EXACT_MAX_N:
                img = resample_exact(data, wcs, ra, dec, n, scale_arcsec, qx, qy)
            else:
                img = resample(data, qx, qy)
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
