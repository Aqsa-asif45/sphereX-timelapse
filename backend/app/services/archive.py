"""Ask IRSA which SPHEREx files cover a sky position.

1. IRSA SIA2, DR1 and QR3 in parallel (fast; about a day behind new data).
2. If a collection fails, or nothing is found: IRSA TAP (slow, but no lag).
3. If IRSA is unreachable: the local sky index (skyindex.py), built from NASA's AWS file listing.
4. Keep each week from one release only: DR1 > QR3 > QR2.

Each candidate is one file = one exposure on one detector. Its "key" is the file's path on NASA's AWS
bucket, which is also the frame id the rest of the app uses.
"""

import asyncio
import io
import re
import time
from datetime import UTC, datetime, timedelta

import httpx
import numpy as np
from astropy.io.votable import parse as parse_votable

from ..config import COLLECTIONS, IRSA_FILES, SIA_URL, TAP_URL, release_rank

# dr1/level2/2025W33_2C/l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits
KEY_RE = re.compile(
    r"^(?P<release>(?:dr|qr)\d+)/level2/(?P<week>\d{4}W\d{2}_\d[A-Z])/"
    r"(?P<version>l2b(?:_retry)?-v(?P<v>\d+)-(?P<year>\d{4})-(?P<doy>\d{3}))/(?P<det>[1-6])/"
    r"level2_(?P=week)_(?P<obs>\d{4})_(?P<exp>\d)D(?P=det)_spx_[\w.-]+\.fits$"
)


class ArchiveError(RuntimeError):
    """IRSA could not be asked, or answered with an error."""


def key_from_url(url: str) -> str | None:
    """'https://irsa.../ibe/data/spherex/dr1/level2/...fits' or 'ibe/data/spherex/dr1/...' -> 'dr1/level2/...fits'."""
    m = re.search(r"spherex/((?:dr|qr)\d+/level2/.+\.fits)$", url or "")
    return m.group(1) if m and KEY_RE.match(m.group(1)) else None


def describe_key(key: str) -> dict:
    """Release, week, version, processing date, observation, exposure and detector from a file key."""
    m = KEY_RE.match(key)
    if not m:
        raise ValueError(f"Not a SPHEREx spectral image: {key}")
    processed = datetime(int(m["year"]), 1, 1, tzinfo=UTC) + timedelta(days=int(m["doy"]) - 1)
    return {
        "id": key,
        "release": m["release"],
        "week": m["week"],
        "version": m["version"],
        "processing_date": processed.date().isoformat(),
        "obs": int(m["obs"]),
        "exp": int(m["exp"]),
        "det": int(m["det"]),
        "file_url": IRSA_FILES + key,
    }


def _rows(content: bytes) -> list[dict]:
    vot = parse_votable(io.BytesIO(content), verify="ignore")
    for info in [*vot.infos, *(i for r in vot.resources for i in r.infos)]:
        if info.name == "QUERY_STATUS" and info.value == "ERROR":
            raise ArchiveError(f"IRSA error: {(info.content or '').strip()[:200]}")
    tables = list(vot.iter_tables())
    if not tables:
        return []
    t = tables[0].to_table(use_names_over_ids=True)
    return [{k: (None if np.ma.is_masked(r[k]) else r[k]) for k in t.colnames} for r in t]


def _um(metres) -> float | None:
    return None if metres is None else round(float(metres) * 1e6, 4)


async def sia_search(client: httpx.AsyncClient, ra: float, dec: float, collection: str) -> list[dict]:
    params = {
        "COLLECTION": collection,
        "POS": f"CIRCLE {ra} {dec} 0.0005",
        "RESPONSEFORMAT": "VOTABLE",
        "MAXREC": "20000",
    }
    for attempt in range(3):  # IRSA sometimes drops connections or sends a broken reply: retry
        try:
            r = await client.get(SIA_URL, params=params, timeout=httpx.Timeout(40, connect=10))
            r.raise_for_status()
            rows = await asyncio.to_thread(_rows, r.content)
            break
        except (httpx.HTTPError, ValueError) as e:
            if attempt == 2:
                raise ArchiveError(f"SIA2 ({collection}) unreachable: {type(e).__name__}") from e
            await asyncio.sleep(1.5 * (attempt + 1))
    out = []
    for row in rows:
        key = key_from_url(str(row.get("access_url") or ""))
        if not key or row.get("dataproduct_type") not in (None, "image"):
            continue
        out.append(
            {
                **describe_key(key),
                "mjd_start": float(row["t_min"]),
                "lambda_min_um": _um(row.get("em_min")),
                "lambda_max_um": _um(row.get("em_max")),
                "found_via": "IRSA SIA2",
            }
        )
    return out


async def tap_search(client: httpx.AsyncClient, ra: float, dec: float) -> list[dict]:
    """No ingestion lag, but slow (over a minute has been seen)."""
    q = (
        "SELECT a.uri, p.time_bounds_lower, p.energy_bounds_lower, p.energy_bounds_upper "
        "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "
        f"WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)"
    )
    try:
        r = await client.get(TAP_URL, params={"QUERY": q, "LANG": "ADQL", "FORMAT": "votable"}, timeout=180)
        r.raise_for_status()
        rows = await asyncio.to_thread(_rows, r.content)
    except (httpx.HTTPError, ValueError) as e:
        raise ArchiveError(f"TAP unreachable: {type(e).__name__}") from e
    out = []
    for row in rows:
        key = key_from_url(str(row.get("uri") or ""))
        if key:
            out.append(
                {
                    **describe_key(key),
                    "mjd_start": float(row["time_bounds_lower"]),
                    "lambda_min_um": _um(row.get("energy_bounds_lower")),
                    "lambda_max_um": _um(row.get("energy_bounds_upper")),
                    "found_via": "IRSA TAP",
                }
            )
    return out


def one_release_per_week(cands: list[dict]) -> list[dict]:
    """Keep each week from its best release only (DR1 > QR3 > QR2), and each file once."""
    best: dict[str, str] = {}
    for c in cands:
        if c["week"] not in best or release_rank(c["release"]) > release_rank(best[c["week"]]):
            best[c["week"]] = c["release"]
    seen, out = set(), []
    for c in cands:
        if best[c["week"]] == c["release"] and c["id"] not in seen:
            seen.add(c["id"])
            out.append(c)
    return sorted(out, key=lambda c: (c["mjd_start"], c["det"]))


_irsa_state = {"ok": None, "at": 0.0}


async def irsa_reachable(client: httpx.AsyncClient) -> bool:
    """A quick check (remembered for a minute) so a search does not wait on IRSA's long timeouts."""
    if _irsa_state["ok"] is not None and time.monotonic() - _irsa_state["at"] < 60:
        return _irsa_state["ok"]
    try:
        # ask the search service itself (a metadata-only query): IRSA's home page was seen taking 9 s while
        # SIA2 answered in 1 s, which wrongly sent searches to the slower offline index
        params = {"COLLECTION": "spherex_dr1", "POS": "CIRCLE 0 0 0.0001", "MAXREC": "0", "RESPONSEFORMAT": "VOTABLE"}
        r = await client.get(SIA_URL, params=params, timeout=httpx.Timeout(10, connect=5))
        ok = r.status_code < 500
    except httpx.HTTPError:
        ok = False
    _irsa_state.update(ok=ok, at=time.monotonic())
    return ok


def _from_index(ra: float, dec: float) -> list[dict]:
    from . import skyindex  # imported here: skyindex is only needed when IRSA is down

    out, seen = [], set()
    for c in skyindex.candidates(ra, dec):
        if c["ids"][0] not in seen:
            seen.add(c["ids"][0])
            out.append({**describe_key(c["ids"][0]), **c, "lambda_min_um": None, "lambda_max_um": None})
    return out


async def find_candidates(client: httpx.AsyncClient, ra: float, dec: float, report=None) -> dict:
    """Every file IRSA lists at this position, one release per week. Never hides a failed source."""

    def say(**event):
        if report:
            report(event)

    if not await irsa_reachable(client):
        say(type="fallback", source="index", reason="IRSA is unreachable")
        from .skyindex import coverage

        cov = coverage()
        return {
            "candidates": one_release_per_week(_from_index(ra, dec)),
            "sources": ["index"],
            "complete": True,
            "errors": {"irsa": "unreachable"},
            "notes": [
                f"IRSA is unreachable, so the local sky index was used ({cov['indexed_weeks']} of "
                f"{cov['weeks']} weeks indexed). Weeks newer than the index are missing."
            ],
        }

    async def one(collection: str):
        try:
            got = await sia_search(client, ra, dec, collection)
            say(type="collection", collection=collection, count=len(got))
            return got, None
        except ArchiveError as e:
            say(type="collection", collection=collection, error=str(e))
            return [], str(e)

    results = await asyncio.gather(*(one(c) for c in COLLECTIONS))
    cands = [c for got, _ in results for c in got]
    errors = {c: e for c, (_, e) in zip(COLLECTIONS, results, strict=True) if e}
    notes, sources, complete = [], ["sia2"] if any(not e for _, e in results) else [], not errors

    if errors or not cands:
        why = f"SIA2 failed for {', '.join(errors)}" if errors else "SIA2 found nothing (it can lag new data by a day)"
        say(type="fallback", source="tap", reason=why)
        try:
            wanted = set(COLLECTIONS.values())
            cands += [c for c in await tap_search(client, ra, dec) if c["release"] in wanted]
            sources.append("tap")
            complete = True
            notes.append(f"{why}; filled in from IRSA TAP.")
        except ArchiveError as e:
            errors["tap"] = str(e)
            say(type="fallback", source="index", reason=f"TAP failed too ({e})")
            cands += _from_index(ra, dec)  # one release per week (below) keeps IRSA's rows where it answered
            sources.append("index")
            complete = True
            notes.append(f"{why}; TAP failed too, so the local sky index filled in.")

    return {
        "candidates": one_release_per_week(cands),
        "sources": sources,
        "complete": complete,
        "errors": errors,
        "notes": notes,
    }
