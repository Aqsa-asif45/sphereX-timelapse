"""Release-aware SPHEREx observation search.

Primary: IRSA SIA2 (fast; about a day behind new weekly data). Fallback: IRSA TAP (no lag; slow).
Every observation carries its provenance: release, collection, observation ID, pipeline version,
processing date, file URL and when we retrieved it. Each week is taken from one release only.
"""
import asyncio
import io
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

import httpx
import numpy as np
from astropy.io.votable import parse as parse_votable
from astropy.time import Time

from .config import COLLECTIONS, DEFAULT_COLLECTIONS, IBE_PREFIX, IRSA, SIA_URL, TAP_URL, USER_AGENT, release_rank

_VERSION = re.compile(r"/(l2b(?:_retry)?)-v(\d+)-(\d{4})-(\d{3})/")
_FILE = re.compile(r"level2_(\d{4}W\d{2}_\d[A-Z])_(\d{4})_(\d)D(\d)_spx_")


class ArchiveError(RuntimeError):
    """The archive could not be asked, or answered with an error."""


@dataclass
class Observation:
    obs_id: str
    release: str
    collection: str
    survey: str
    week: str
    large_slew: int
    small_slew: int
    detector: int
    mjd: float
    utc: str
    lambda_min_um: float | None
    lambda_max_um: float | None
    access_url: str
    cutout_capable: bool
    pipeline: str
    version: str
    processing_date: str
    adapter: str
    retrieved_utc: str
    notes: list[str] = field(default_factory=list)

    def public(self) -> dict:
        return asdict(self)


def provenance_from_url(url: str) -> dict:
    """Pipeline name, version and processing date encoded in a SPHEREx file path, e.g.
    .../l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits"""
    m = _VERSION.search(url)
    f = _FILE.search(url)
    out = {"pipeline": "", "version": "", "processing_date": "", "week": "", "large_slew": 0, "small_slew": 0, "detector": 0}
    if m:
        doy = datetime.strptime(f"{m.group(3)}-{m.group(4)}", "%Y-%j").date()
        out.update(pipeline=m.group(1), version=f"v{m.group(2)}", processing_date=doy.isoformat())
    if f:
        out.update(week=f.group(1), large_slew=int(f.group(2)), small_slew=int(f.group(3)), detector=int(f.group(4)))
    return out


def _mjd_to_utc(mjd: float) -> str:
    return Time(mjd, format="mjd", scale="utc").isot[:19] + "Z"


def _um(metres) -> float | None:
    """Metres → µm; None when the archive did not say (never NaN: JSON cannot carry it)."""
    try:
        v = float(metres) * 1e6
    except (TypeError, ValueError):
        return None
    return v if v == v else None


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _rows_from_votable(content: bytes) -> list[dict]:
    vot = parse_votable(io.BytesIO(content), verify="ignore")
    for info in vot.infos:
        if info.name == "QUERY_STATUS" and info.value == "ERROR":
            raise ArchiveError(f"SIA2 error: {(info.content or '').strip()[:200]}")
    for res in vot.resources:
        for info in res.infos:
            if info.name == "QUERY_STATUS" and info.value == "ERROR":
                raise ArchiveError(f"SIA2 error: {(info.content or '').strip()[:200]}")
    tables = list(vot.iter_tables())
    if not tables:
        return []
    t = tables[0].to_table(use_names_over_ids=True)  # IRSA's FIELD IDs differ from the standard ObsCore names
    rows = []
    for r in t:
        rows.append({k: (None if np.ma.is_masked(r[k]) else (r[k].item() if hasattr(r[k], "item") else r[k])) for k in t.colnames})
    return rows


async def sia_search(client: httpx.AsyncClient, ra: float, dec: float, radius_deg: float, collection: str) -> list[Observation]:
    params = {"COLLECTION": collection, "POS": f"CIRCLE {ra} {dec} {radius_deg}", "RESPONSEFORMAT": "VOTABLE", "MAXREC": "20000"}
    for attempt in range(3):  # IRSA sometimes drops connections; retry with a short back-off before giving up
        try:
            # short attempts: a hung request should hand over to the retry / TAP fallback quickly
            r = await client.get(SIA_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=httpx.Timeout(25, connect=10))
            r.raise_for_status()
            break
        except httpx.HTTPError as e:
            if attempt == 2:
                raise ArchiveError(f"SIA2 ({collection}) unreachable: {type(e).__name__}") from e
            await asyncio.sleep(1.5 * (attempt + 1))
    rows = await asyncio.to_thread(_rows_from_votable, r.content)
    release, survey = COLLECTIONS[collection]
    got = _now()
    out = []
    for row in rows:
        url = str(row.get("access_url") or "")
        if not url.startswith(IBE_PREFIX) or row.get("dataproduct_type") not in (None, "image"):
            continue
        p = provenance_from_url(url)
        mjd = float(row["t_min"])
        out.append(Observation(
            obs_id=str(row.get("obs_id") or ""), release=release, collection=collection, survey=survey, week=p["week"],
            large_slew=p["large_slew"], small_slew=p["small_slew"], detector=p["detector"] or int(str(row.get("energy_bandpassname", "D0"))[-1]),
            mjd=mjd, utc=_mjd_to_utc(mjd), lambda_min_um=float(row["em_min"]) * 1e6, lambda_max_um=float(row["em_max"]) * 1e6,
            access_url=url, cutout_capable=True, pipeline=p["pipeline"], version=p["version"], processing_date=p["processing_date"],
            adapter="IRSA SIA2", retrieved_utc=got))
    return out


async def tap_search(client: httpx.AsyncClient, ra: float, dec: float) -> list[Observation]:
    """No ingestion lag, but slow (over a minute seen). Used when SIA2 fails or finds nothing."""
    q = ("SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname, p.energy_bounds_lower, p.energy_bounds_upper "
         "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "
         f"WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly) ORDER BY p.time_bounds_lower")
    try:
        r = await client.get(TAP_URL, params={"QUERY": q, "LANG": "ADQL", "FORMAT": "votable"}, headers={"User-Agent": USER_AGENT}, timeout=180)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise ArchiveError(f"TAP unreachable: {type(e).__name__}") from e
    rows = await asyncio.to_thread(_rows_from_votable, r.content)
    got, out = _now(), []
    for row in rows:
        uri = str(row.get("uri") or "")
        m = re.search(r"spherex/((?:dr|qr)\d+)/level2/", uri)
        if not m:
            continue
        release = m.group(1)
        url = uri if uri.startswith("http") else f"{IRSA}/{uri.lstrip('/')}"
        p = provenance_from_url(url)
        mjd = float(row["time_bounds_lower"])
        out.append(Observation(
            obs_id=f"{p['week']}_{p['large_slew']:04d}_{p['small_slew']}", release=release, collection=f"spherex_{release}", survey="wide",
            week=p["week"], large_slew=p["large_slew"], small_slew=p["small_slew"], detector=p["detector"], mjd=mjd, utc=_mjd_to_utc(mjd),
            lambda_min_um=_um(row.get("energy_bounds_lower")), lambda_max_um=_um(row.get("energy_bounds_upper")),
            access_url=url, cutout_capable=url.startswith(IBE_PREFIX),
            pipeline=p["pipeline"], version=p["version"], processing_date=p["processing_date"], adapter="IRSA TAP", retrieved_utc=got))
    return out


def one_release_per_week(obs: list[Observation]) -> list[Observation]:
    """If an exposure exists in several releases, keep the best release's copy (DR1 > QR3 > QR2)."""
    best: dict[tuple, Observation] = {}
    for o in obs:
        k = (o.week, o.large_slew, o.small_slew, o.detector)
        if k not in best or release_rank(o.release) > release_rank(best[k].release):
            best[k] = o
    return sorted(best.values(), key=lambda o: (o.mjd, o.detector))


async def search(client: httpx.AsyncClient, ra: float, dec: float, radius_deg: float = 0.0005,
                 collections: list[str] | None = None, progress=None) -> dict:
    """Search every requested collection in parallel; fall back to TAP if SIA2 fails or finds nothing."""
    collections = collections or DEFAULT_COLLECTIONS
    t0 = time.perf_counter()
    report = lambda **e: progress and progress(e)  # noqa: E731
    report(type="SEARCH_STARTED", collections=collections)

    async def one(c):
        try:
            got = await sia_search(client, ra, dec, radius_deg, c)
            # progressive: the client can show (and open) these before the other collections answer
            report(type="COLLECTION_DONE", collection=c, count=len(got), observations=[o.public() for o in one_release_per_week(got)])
            return c, got, None
        except ArchiveError as e:
            report(type="COLLECTION_FAILED", collection=c, error=str(e))
            return c, [], str(e)

    results = await asyncio.gather(*(one(c) for c in collections))
    obs = [o for _, got, _ in results for o in got]
    errors = {c: e for c, _, e in results if e}
    notes, adapter, complete = [], "IRSA SIA2", not errors
    if errors or not obs:
        # a failed collection is never silently left out: TAP covers every release, so it fills the gap
        why = f"SIA2 failed for {', '.join(errors)} ({'; '.join(errors.values())})" if errors else \
              "SIA2 returned no observations (it can lag new data by about a day)"
        report(type="FALLBACK", adapter="IRSA TAP", reason=why)
        try:
            wanted = {COLLECTIONS[c][0] for c in collections}
            tap = [o for o in await tap_search(client, ra, dec) if o.release in wanted]
            obs = obs + tap  # SIA2 rows first, so their fuller metadata wins when both list an exposure
            adapter = "IRSA SIA2 + TAP" if any(not e for _, _, e in results) and len(obs) > len(tap) else "IRSA TAP"
            complete = True
            notes.append(f"{why}; filled in from IRSA TAP.")
        except ArchiveError as e:
            errors["tap"] = str(e)
            notes.append(f"{why}; TAP failed too, so these results may be incomplete.")
    obs = one_release_per_week(obs)
    out = {"ra": ra, "dec": dec, "radius_deg": radius_deg, "collections": collections, "adapter": adapter, "complete": complete,
           "count": len(obs), "by_release": {r: sum(o.release == r for o in obs) for r in sorted({o.release for o in obs})},
           "observations": [o.public() for o in obs], "errors": errors, "notes": notes,
           "elapsed_s": round(time.perf_counter() - t0, 2), "retrieved_utc": _now()}
    report(type="OBSERVATIONS_FOUND" if obs else "SEARCH_FAILED", count=len(obs))
    return out
