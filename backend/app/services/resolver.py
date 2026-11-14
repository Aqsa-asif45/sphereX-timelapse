"""Turn what the user typed into a sky position.

- Coordinates: decimal degrees or sexagesimal, parsed with Astropy (typographic minus signs accepted).
- The five challenge targets: their checked positions and proper motions.
- Any other name: MAST's name lookup (which asks SIMBAD and NED).

Errors: ValueError = bad input, LookupError = name not found, httpx.HTTPError = name service down.
"""

import json
import re

import astropy.units as u
import httpx
from astropy.coordinates import SkyCoord

from ..config import J2000_MJD, MAST_URL
from .targets import find_target

_DASHES = re.compile("[−‐-―﹣－]")  # all the "minus-looking" characters
_SYMBOLS = {"′": "m", "″": "s", "'": "m", '"': "s", "°": "d"}
_DECIMAL = re.compile(r"[+-]?\d+(\.\d+)?(d|deg)?")
_SEXA_HINT = re.compile(r"[hms:d]|\d\s+\d")

_cache: dict[str, dict] = {}


def normalise(q: str) -> str:
    q = _DASHES.sub("-", q.strip())
    for k, v in _SYMBOLS.items():
        q = q.replace(k, v)
    return re.sub(r"\s*,\s*", " ", q)


def parse_coords(q: str) -> tuple[float, float] | None:
    """Return (ra, dec) in degrees (ICRS) for typed coordinates, or None if it is not coordinates.

    Accepts '133.795 -7.245', '08h55m10.8s -07d14m42s', '08:55:10.8 -07:14:42',
    '08 55 10.8 -07 14 42' and the app's own '08h55m10.80s −07°14′42.0″'.
    """
    s = normalise(q)
    parts = s.split()
    try:
        if len(parts) == 2 and all(_DECIMAL.fullmatch(p) for p in parts):
            ra, dec = (float(re.sub(r"(d|deg)$", "", p)) for p in parts)
            return (ra, dec) if 0 <= ra < 360 and -90 <= dec <= 90 else None
        if len(parts) == 6 and all(re.fullmatch(r"[+-]?\d+(\.\d+)?", p) for p in parts):
            s = f"{parts[0]}h{parts[1]}m{parts[2]}s {parts[3]}d{parts[4]}m{parts[5]}s"
        if _SEXA_HINT.search(s) and re.search(r"\d", s):
            c = SkyCoord(s, unit=(u.hourangle, u.deg), frame="icrs")
            return float(c.ra.deg), float(c.dec.deg)
    except (ValueError, u.UnitsError):
        return None
    return None


async def mast_lookup(client: httpx.AsyncClient, name: str) -> dict:
    req = {"service": "Mast.Name.Lookup", "params": {"input": name, "format": "json"}, "format": "json"}
    r = await client.post(MAST_URL, data={"request": json.dumps(req)}, timeout=25)
    r.raise_for_status()
    hit = (r.json().get("resolvedCoordinate") or [None])[0]
    if not hit or not isinstance(hit.get("ra"), (int, float)):
        raise LookupError(f"No object called “{name}” was found.")
    return {
        "name": str(hit.get("canonicalName") or name).removeprefix("NAME "),
        "ra": float(hit["ra"]),
        "dec": float(hit["decl"]),
        "epoch_mjd": J2000_MJD,
        "kind": hit.get("objectType"),
        "source": f"{hit.get('resolver')} via MAST",
    }


async def resolve(client: httpx.AsyncClient | None, q: str) -> dict:
    """Name or coordinates -> {name, ra, dec, epoch_mjd, pmra, pmdec, kind, source, ...}."""
    q = (q or "").strip()[:200]
    if not q:
        raise ValueError("Type a name or coordinates.")

    c = parse_coords(q)
    if c:
        return {
            "name": q,
            "ra": c[0],
            "dec": c[1],
            "epoch_mjd": J2000_MJD,
            "pmra": None,
            "pmdec": None,
            "kind": None,
            "source": "coordinates as typed (ICRS)",
        }

    key = q.lower()
    if key in _cache:
        return _cache[key]

    t = find_target(q)
    if t:
        if t.ra is not None:
            pos = {"ra": t.ra, "dec": t.dec, "epoch_mjd": t.epoch_mjd, "source": t.position_source}
        else:
            pos = await mast_lookup(client, t.lookup)
        out = {
            "name": t.name,
            "ra": pos["ra"],
            "dec": pos["dec"],
            "epoch_mjd": pos["epoch_mjd"],
            "pmra": t.pmra,
            "pmdec": t.pmdec,
            "kind": t.kind,
            "source": pos["source"],
            "pm_source": t.pm_source,
            "slug": t.slug,
            "classification": t.classification,
            "in_gaia": t.in_gaia,
            "note": t.note,
        }
    else:
        out = {**await mast_lookup(client, q), "pmra": None, "pmdec": None}
    _cache[key] = out
    return out
