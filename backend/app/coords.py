"""Turn what a user typed into a sky position: coordinates (parsed with Astropy) or a name (MAST name lookup)."""
import json
import re

import astropy.units as u
import httpx
from astropy.coordinates import SkyCoord

from .config import MAST_LOOKUP, USER_AGENT
from .targets import BY_SLUG, J2000_MJD, TARGETS

_DASHES = re.compile("[−‐-―﹣－]")
_PRIMES = {"′": "m", "″": "s", "'": "m", '"': "s", "°": "d"}
_SEXA_HINT = re.compile(r"[hms:°′″'\"d]|\d\s+\d")


def normalise(q: str) -> str:
    q = _DASHES.sub("-", q.strip())
    for k, v in _PRIMES.items():
        q = q.replace(k, v)
    return re.sub(r"\s*,\s*", " ", q)


def parse_coords(q: str) -> tuple[float, float] | None:
    """Decimal degrees ('133.795 -7.245') or sexagesimal ('08h55m10.8s -07d14m42s', '08:55:10.8 -07:14:42',
    '08 55 10.8 -07 14 42', or the app's own '08h55m10.80s −07°14′42.0″'). Returns ICRS degrees or None."""
    s = normalise(q)
    parts = s.split()
    try:
        if len(parts) == 2 and all(re.fullmatch(r"[+-]?\d+(\.\d+)?(d|deg)?", p) for p in parts):
            ra, dec = (float(re.sub(r"(d|deg)$", "", p)) for p in parts)
            if not (0 <= ra < 360 and -90 <= dec <= 90):
                return None
            return ra, dec
        if len(parts) == 6:  # 'hh mm ss dd mm ss'
            s = f"{parts[0]}h{parts[1]}m{parts[2]}s {parts[3]}d{parts[4]}m{parts[5]}s"
        if _SEXA_HINT.search(s):
            c = SkyCoord(s, unit=(u.hourangle, u.deg), frame="icrs")
            return float(c.ra.deg), float(c.dec.deg)
    except (ValueError, u.UnitsError):
        return None
    return None


_norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())  # noqa: E731
_cache: dict[str, dict] = {}


async def mast_lookup(client: httpx.AsyncClient, name: str) -> dict:
    req = {"service": "Mast.Name.Lookup", "params": {"input": name, "format": "json"}, "format": "json"}
    r = await client.post(MAST_LOOKUP, data={"request": json.dumps(req)}, headers={"User-Agent": USER_AGENT}, timeout=25)
    r.raise_for_status()
    hit = (r.json().get("resolvedCoordinate") or [None])[0]
    if not hit or not isinstance(hit.get("ra"), (int, float)):
        raise LookupError(f"No object called “{name}” was found.")
    return {"name": str(hit.get("canonicalName") or name).removeprefix("NAME "), "ra": float(hit["ra"]), "dec": float(hit["decl"]),
            "epoch_mjd": J2000_MJD, "kind": hit.get("objectType"), "source": f"{hit.get('resolver')} via MAST"}


async def resolve(client: httpx.AsyncClient, q: str) -> dict:
    """Coordinates are used as typed; challenge targets come with their checked positions; other names go to MAST."""
    q = q.strip()[:200]
    if not q:
        raise ValueError("Type a name or coordinates.")
    c = parse_coords(q)
    if c:
        return {"name": q, "ra": c[0], "dec": c[1], "epoch_mjd": J2000_MJD, "source": "coordinates as typed (ICRS)", "kind": None}
    n = _norm(q)
    if n in _cache:
        return _cache[n]
    t = BY_SLUG.get(q) or next((t for t in TARGETS if n in (_norm(t.name), _norm(t.slug), _norm(t.lookup or ""))), None)
    if t:
        pos = {"ra": t.ra, "dec": t.dec, "epoch_mjd": t.epoch_mjd, "source": t.position_source} if t.ra is not None else await mast_lookup(client, t.lookup)
        out = {"name": t.name, "ra": pos["ra"], "dec": pos["dec"], "epoch_mjd": pos["epoch_mjd"], "source": pos["source"],
               "kind": t.kind, "classification": t.classification, "slug": t.slug, "pmra": t.pmra, "pmdec": t.pmdec, "pm_source": t.pm_source}
    else:
        out = await mast_lookup(client, q)
    _cache[n] = out
    return out
