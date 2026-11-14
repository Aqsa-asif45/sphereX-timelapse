"""Find every SPHEREx exposure of a position, and confirm each one from its own header.

For each candidate file from IRSA we compute, from the file itself:
  - where the target falls on the detector (FITS pixel, 1-based), using the star's proper motion
    to place it on that date; files where it falls off the detector are dropped;
  - the exposure time (MJD-AVG, UTC);
  - the wavelength and bandwidth at that pixel (spectral WCS without SIP);
  - the angle of north on the image.
Very busy fields keep 400 exposures, spread evenly over time. Results are cached (never when empty).
"""

import asyncio
import hashlib
import json
import math
import time
from datetime import UTC, datetime

import httpx
from astropy.io import fits
from astropy.time import Time

from ..config import NPIX, REF_MJD, settings
from . import archive
from .archive import describe_key
from .fitsio import FileReadError, NotOnAws, file_header, sky_wcs, spectral_wcs

SEARCH_VERSION = "s3"  # s3: pmdec was read from pmra before; s2: deep-survey collections added


def position_at(ra: float, dec: float, epoch_mjd: float, pmra: float | None, pmdec: float | None, mjd: float):
    """Move a star from its catalogue epoch to `mjd` with its proper motion (mas/yr)."""
    years = (mjd - epoch_mjd) / 365.25
    dec2 = dec + (pmdec or 0) * years / 3.6e6
    ra2 = ra + (pmra or 0) * years / 3.6e6 / math.cos(math.radians(dec))
    return ra2 % 360, dec2


def thin_evenly(items: list, cap: int) -> list:
    """Keep `cap` items spread evenly through the (time-sorted) list."""
    if len(items) <= cap:
        return items
    return [items[round(i * (len(items) - 1) / (cap - 1))] for i in range(cap)]


def confirm(cand: dict, info: dict, star: tuple) -> dict | None:
    """Turn a candidate file plus its header into a frame, or None if the target is off the detector."""
    h = fits.Header.fromstring(info["image_header"])
    mjd = float(h.get("MJD-AVG", cand["mjd_start"]))
    ra, dec = position_at(*star, mjd)
    sky = sky_wcs(info["image_header"])
    x0, y0 = (float(v) for v in sky.world_to_pixel_values(ra, dec))  # 0-based
    if not (-0.5 <= x0 <= NPIX - 0.5 and -0.5 <= y0 <= NPIX - 0.5):
        return None
    lam, dlam = (float(v) for v in spectral_wcs(info["image_header"], info["wave_hdu"]).pixel_to_world_values(x0, y0))
    xn, yn = (float(v) for v in sky.world_to_pixel_values(ra, min(dec + 10 / 3600, 89.9999)))
    return {
        **{
            k: cand[k]
            for k in (
                "id",
                "release",
                "week",
                "version",
                "processing_date",
                "obs",
                "exp",
                "det",
                "file_url",
                "found_via",
            )
        },
        "mjd": mjd,
        "utc": Time(mjd, format="mjd", scale="utc").isot[:19] + "Z",
        "x": round(x0 + 1, 3),  # FITS pixels are 1-based
        "y": round(y0 + 1, 3),
        "lambda_um": round(lam, 5),
        "dlambda_um": round(dlam, 5),
        # angle of north on the image, measured from the +y axis towards +x, degrees
        "north_deg": round(math.degrees(math.atan2(xn - x0, yn - y0)), 3),
        "data_start": info["data_start"],
    }


def _cache_path(ra, dec, epoch, pmra, pmdec):
    raw = f"{SEARCH_VERSION}|{ra:.6f}|{dec:.6f}|{epoch:.2f}|{pmra or 0:.3f}|{pmdec or 0:.3f}"
    return settings.cache_dir / "searches" / (hashlib.sha1(raw.encode()).hexdigest() + ".json")


async def search(
    client: httpx.AsyncClient,
    ra: float,
    dec: float,
    epoch_mjd: float,
    pmra: float | None = None,
    pmdec: float | None = None,
    report=None,
) -> dict:
    """The full search. `report(event)` is called with progress events (for the live stream)."""
    t0 = time.perf_counter()
    path = _cache_path(ra, dec, epoch_mjd, pmra, pmdec)
    if path.exists() and not settings.no_search_cache:
        out = json.loads(path.read_text())
        out["from_cache"] = True
        return out

    def say(**event):
        if report:
            report(event)

    star = (ra, dec, epoch_mjd, pmra, pmdec)
    search_ra, search_dec = position_at(*star, REF_MJD)
    say(type="started", ra=search_ra, dec=search_dec)
    found = await archive.find_candidates(client, search_ra, search_dec, report)
    cands = found["candidates"]

    # group files into exposures (both twin detectors of one exposure belong together), then cap
    exposures: dict[tuple, list] = {}
    for c in cands:
        exposures.setdefault((c["week"], c["obs"], c["exp"]), []).append(c)
    groups = sorted(exposures.values(), key=lambda g: g[0]["mjd_start"])
    # IRSA names exactly the exposures that contain the position; the sky index proposes candidates,
    # about half of which are dropped on checking, so it gets a bigger budget before the check
    budget = settings.max_exposures * (3 if "index" in found["sources"] else 1)
    kept = thin_evenly(groups, budget)
    todo = [c for g in kept for c in g]

    sem = asyncio.Semaphore(settings.http_concurrency)
    frames, failed, done, last = [], 0, 0, 0.0

    async def one(c):
        nonlocal failed, done, last
        try:
            for i, key in enumerate(c.get("ids") or [c["id"]]):  # sky-index candidates: newest version first
                try:
                    info = await file_header(client, sem, key)
                except NotOnAws:
                    if i == len(c.get("ids") or [c["id"]]) - 1:
                        break  # in no version: this exposure does not exist on that detector
                    continue
                cand = {**c, **(describe_key(key) if key != c["id"] else {})}
                f = await asyncio.to_thread(confirm, cand, info, star)
                if f:
                    frames.append(f)
                break
        except (FileReadError, ValueError):
            failed += 1
        done += 1
        if time.perf_counter() - last > 0.3 or done == len(todo):
            last = time.perf_counter()
            say(type="progress", done=done, total=len(todo), frames=len(frames))

    await asyncio.gather(*(one(c) for c in todo))
    frames.sort(key=lambda f: (f["mjd"], f["det"]))
    confirmed: dict[tuple, list] = {}
    for f in frames:
        confirmed.setdefault((f["week"], f["obs"], f["exp"]), []).append(f)
    if len(confirmed) > settings.max_exposures:  # the sky index's bigger budget: cap again after checking
        frames = [f for g in thin_evenly(list(confirmed.values()), settings.max_exposures) for f in g]
    by_release: dict[str, int] = {}
    for f in frames:
        by_release[f["release"]] = by_release.get(f["release"], 0) + 1

    out = {
        "ra": ra,
        "dec": dec,
        "epoch_mjd": epoch_mjd,
        "pmra": pmra,
        "pmdec": pmdec,
        "search_ra": search_ra,
        "search_dec": search_dec,
        "sources": found["sources"],
        "complete": found["complete"] and failed == 0,
        "count": len(frames),
        "by_release": by_release,
        # sky-index candidates include ones that turn out not to contain the position: estimate the real number
        "exposures_available": (
            round(len(confirmed) * len(groups) / max(1, len(kept))) if "index" in found["sources"] else len(groups)
        ),
        "exposures_kept": len({(f["week"], f["obs"], f["exp"]) for f in frames}),
        "files_failed": failed,
        "frames": frames,
        "errors": found["errors"],
        "notes": found["notes"],
        "elapsed_s": round(time.perf_counter() - t0, 2),
        "retrieved_utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "from_cache": False,
    }
    if frames and out["complete"] and not settings.no_search_cache:  # never cache an empty or partial answer
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out))
    return out
