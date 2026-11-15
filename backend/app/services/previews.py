"""Animated previews for the home page: one looping GIF per challenge target, one frame per SPHEREx visit.

Built on the server from real cutouts (4' field, 39 x 39 SPHEREx pixels), the same way the old site did:
each exposure is put in noise units, each visit is stacked with a sigma-clipped mean, painted with the
inferno colour map on an asinh stretch, enlarged 8x (312 px), and an amber ring marks where the target
is on that visit's date. Nothing is invented: blank pixels are drawn in the gap colour.
"""

import asyncio
import io
import math

import numpy as np
from PIL import Image, ImageDraw

from ..config import PIXEL_ARCSEC, REF_MJD, settings
from .cutouts import get_cutout
from .frames import position_at, search
from .resolver import resolve
from .targets import BY_SLUG

N, UP = 39, 8  # 39 px = 4' of sky, shown at 312 px
SIZE = N * UP
VERSION = "p3"  # p3: impossible pixels blanked; p2: exact resampling, long passes cut into ~30-day steps
RING_RADIUS = 22  # px on the enlarged image
AMBER, GAP = (255, 184, 77), (18, 22, 32)
CONTRAST, SOFT = 25.0, 3.0
INFERNO = ["#000004", "#160b39", "#420a68", "#6a176e", "#932667", "#bc3754",
           "#dd513a", "#f37819", "#fca50a", "#f6d746", "#fcffa4"]  # fmt: skip

_stops = np.array([[int(h[i : i + 2], 16) for i in (1, 3, 5)] for h in INFERNO], dtype=float)
LUT = np.array([[np.interp(k / 255 * 10, np.arange(11), _stops[:, c]) for c in range(3)] for k in range(256)])
LUT = np.round(LUT).astype(np.uint8)

_building: dict[str, asyncio.Task] = {}


def preview_path(slug: str):
    return settings.cache_dir / "previews" / f"{slug}.{VERSION}.gif"


def normalise(raw: np.ndarray) -> np.ndarray | None:
    """Subtract the background (median) and divide by the noise (robust MAD): 'sigma units'."""
    v = raw[np.isfinite(raw)]
    if v.size < 20:
        return None
    med = np.median(v)
    sig = 1.4826 * np.median(np.abs(v - med)) or 1e-6
    return (raw - med) / sig


def stack(frames: list[np.ndarray]) -> np.ndarray:
    """Pixel-by-pixel sigma-clipped mean: values more than 4 sigma from the pixel's median are dropped."""
    a = np.stack(frames)
    with np.errstate(all="ignore"):
        med = np.nanmedian(a, axis=0)
        lim = np.maximum(4 * 1.4826 * np.nanmedian(np.abs(a - med), axis=0), 1.5)
        keep = np.abs(a - med) <= lim
        n = keep.sum(axis=0)
        out = np.where(keep, a, 0).sum(axis=0) / np.where(n > 0, n, 1)
        out = np.where(n > 0, out, med)
        count = np.isfinite(a).sum(axis=0)
        out = np.where(count < 3, np.nanmean(a, axis=0), out)  # too few to clip: plain mean
    return out


def paint(s: np.ndarray) -> np.ndarray:
    """Sigma units -> RGB with an asinh stretch and the inferno colour map; blank pixels in the gap colour."""
    with np.errstate(invalid="ignore"):
        level = np.arcsinh(np.maximum(0, s + 1.5) / SOFT) / np.arcsinh((CONTRAST + 1.5) / SOFT)
    rgb = LUT[np.round(np.clip(np.nan_to_num(level), 0, 1) * 255).astype(int)]
    rgb[~np.isfinite(s)] = GAP
    return rgb


LONG_PASS_DAYS, STEP_DAYS = 60, 30  # same rule as groupVisits in frontend/src/lib/astro.js


def visits(frames: list[dict]) -> list[list[dict]]:
    """Exposures less than 30 days apart belong to one pass; a pass longer than 60 days (fields near the
    ecliptic poles, such as R Draconis, are watched almost non-stop) is cut into equal steps of ~30 days."""
    runs: list[list[dict]] = []
    for f in sorted(frames, key=lambda f: f["mjd"]):
        if runs and f["mjd"] - runs[-1][-1]["mjd"] < 30:
            runs[-1].append(f)
        else:
            runs.append([f])
    out: list[list[dict]] = []
    for r in runs:
        t0, span = r[0]["mjd"], r[-1]["mjd"] - r[0]["mjd"]
        k = math.ceil(span / STEP_DAYS) if span > LONG_PASS_DAYS else 1
        parts: list[list[dict]] = [[] for _ in range(k)]
        for f in r:
            parts[0 if k == 1 else min(k - 1, int((f["mjd"] - t0) / span * k))].append(f)
        out += [p for p in parts if p]
    return out


async def build(client, sem, slug: str) -> bytes:
    t = await resolve(client, slug)
    res = await search(client, t["ra"], t["dec"], t["epoch_mjd"], t.get("pmra"), t.get("pmdec"))
    star = (t["ra"], t["dec"], t["epoch_mjd"], t.get("pmra"), t.get("pmdec"))
    ra, dec = (round(v, 6) for v in position_at(*star, REF_MJD))
    limit = asyncio.Semaphore(settings.cutout_concurrency)

    async def one(f):
        async with limit:
            try:
                raw = np.frombuffer(await get_cutout(client, sem, f["id"], ra, dec, N, PIXEL_ARCSEC), "<f4")
                return f["id"], normalise(raw.reshape(N, N).astype(float))
            except Exception:  # noqa: BLE001 (a missing exposure only thins that visit)
                return f["id"], None

    data = dict(await asyncio.gather(*(one(f) for f in res["frames"])))
    images = []
    c0 = (N - 1) / 2
    for v in visits(res["frames"]):
        layers = [data[f["id"]] for f in v if data.get(f["id"]) is not None]
        if not layers:
            continue
        img = Image.fromarray(paint(stack(layers))).resize((SIZE, SIZE), Image.Resampling.BICUBIC)
        mjd = sum(f["mjd"] for f in v) / len(v)
        pr, pd = position_at(*star, mjd)
        gx = c0 - ((pr - ra + 540) % 360 - 180) * np.cos(np.radians(dec)) * 3600 / PIXEL_ARCSEC  # east is left
        gy = c0 - (pd - dec) * 3600 / PIXEL_ARCSEC  # north is up
        cx, cy = (gx + 0.5) * UP, (gy + 0.5) * UP
        ImageDraw.Draw(img).ellipse(
            [cx - RING_RADIUS, cy - RING_RADIUS, cx + RING_RADIUS, cy + RING_RADIUS], outline=AMBER, width=3
        )
        images.append(img)
    if not images:
        raise RuntimeError("no images for this target yet")
    buf = io.BytesIO()
    images[0].save(buf, format="GIF", save_all=True, append_images=images[1:], duration=700, loop=0)
    path = preview_path(slug)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf.getvalue())
    return buf.getvalue()


_one_at_a_time = asyncio.Semaphore(1)  # five builds at once saturated the connection for every other request


async def _queued_build(client, sem, slug: str) -> bytes:
    async with _one_at_a_time:
        return await build(client, sem, slug)


def start_build(client, sem, slug: str) -> asyncio.Task:
    """Build a preview in the background (once per target, one target at a time)."""
    if slug not in BY_SLUG:
        raise KeyError(slug)
    task = _building.get(slug)
    if task is None or task.done():
        task = asyncio.ensure_future(_queued_build(client, sem, slug))
        _building[slug] = task
    return task
