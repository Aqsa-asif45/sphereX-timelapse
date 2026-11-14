"""The local sky index: where every indexed SPHEREx observation pointed. Used when IRSA is unreachable.

Files (copied from the old site, kept in git):
  data/folders.json        every week folder per release, its processing versions (newest first),
                           and which detectors each version holds
  data/index/<rel>_<week>.json   one row per observation: [obs, exp, ra, dec, pc11, pc12, pc21, pc22, refDet]
                           = the pointing (CRVAL) and pixel matrix (PC, degrees per pixel) of one exposure
                           on detector refDet
  data/focal.json          where detectors 2 and 3 sit relative to detector 1, in detector-1 pixels
Detectors 4-6 see the same sky as 1-3 through a beam splitter, so patch p covers detectors p and p+3.
Each observation is 4 exposures stepped up to ~0.6 deg apart, so we propose all 4 with a generous
margin; frames.py then confirms each file from its own header (about half are dropped).
"""

import json
import math
from datetime import date
from functools import lru_cache

from ..config import DATA_DIR, NPIX, release_rank

MARGIN = 450  # px: exposures 2-4 step up to ~0.6 deg (~350 px) from exposure 1, plus distortion
INDEX_DIR = DATA_DIR / "index"


@lru_cache(maxsize=1)
def folders() -> list[dict]:
    """[{release, name, base, versions (newest first), dets: {version: [detectors]}}, ...]."""
    path = DATA_DIR / "folders.json"
    return json.loads(path.read_text())["folders"] if path.exists() else []


@lru_cache(maxsize=1)
def focal() -> dict:
    path = DATA_DIR / "focal.json"
    return json.loads(path.read_text()) if path.exists() else {}


@lru_cache(maxsize=512)
def load_index(release: str, name: str) -> dict | None:
    """A week's index, only if it was built from every processing version the week has now."""
    path = INDEX_DIR / f"{release}_{name}.json"
    if not path.exists():
        return None
    x = json.loads(path.read_text())
    f = next((f for f in folders() if f["release"] == release and f["name"] == name), None)
    if x.get("format") != 3 or not f or not all(v in x["versions"] for v in f["versions"]):
        return None
    return x


def weeks() -> dict[str, list[dict]]:
    """Week name -> its folders, best release first (DR1 > QR3 > QR2)."""
    by: dict[str, list[dict]] = {}
    for f in folders():
        by.setdefault(f["name"], []).append(f)
    for fs in by.values():
        fs.sort(key=lambda f: -release_rank(f["release"]))
    return by


def week_mjd(name: str) -> float:
    """Approximate middle of a week folder such as '2025W33_2C', as MJD (good to a few days)."""
    year, week, part = int(name[:4]), int(name[5:7]), int(name[8])
    monday = date.fromisocalendar(year, week, 1)
    return (monday - date(1858, 11, 17)).days + min(6.0, (part - 1) * 1.75 + 0.9)


@lru_cache(maxsize=1)
def coverage() -> dict:
    """How much of the sky history the local index covers (each week counted once). Cached: reading
    all index files takes a few seconds; the indexer clears this after it changes anything."""
    ws = weeks()
    indexed, observations = 0, 0
    for fs in ws.values():
        best = next((f for f in fs if load_index(f["release"], f["name"])), None)
        if best:
            indexed += 1
            observations += len(load_index(best["release"], best["name"])["rows"])
    return {"weeks": len(ws), "indexed_weeks": indexed, "observations": observations}


def _sky_to_tan(ra0: float, dec0: float, ra: float, dec: float):
    """Sky -> gnomonic standard coordinates (deg) about (ra0, dec0); None on the far side."""
    d = math.radians
    a, dd, d0 = d(ra - ra0), d(dec), d(dec0)
    cosc = math.sin(d0) * math.sin(dd) + math.cos(d0) * math.cos(dd) * math.cos(a)
    if cosc <= 1e-6:
        return None
    xi = math.cos(dd) * math.sin(a) / cosc
    eta = (math.cos(d0) * math.sin(dd) - math.sin(d0) * math.cos(dd) * math.cos(a)) / cosc
    return math.degrees(xi), math.degrees(eta)


def file_key(folder: dict, version: str, obs: int, exp: int, det: int) -> str:
    return f"{folder['base']}{version}/{det}/level2_{folder['name']}_{obs:04d}_{exp}D{det}_spx_{version}.fits"


def candidates(ra: float, dec: float) -> list[dict]:
    """Files that may contain (ra, dec), from the best indexed release of each week.

    Each candidate lists `ids`: the same file in every processing version that has its detector,
    newest first (a week can be split over versions, so the newest may not hold this observation).
    """
    fp = focal()
    offs = [(0.0, 0.0), tuple(fp.get("d2", (math.nan, math.nan))), tuple(fp.get("d3", (math.nan, math.nan)))]
    out = []
    for name, fs in weeks().items():
        f = next((f for f in fs if load_index(f["release"], f["name"])), None)
        if not f:
            continue
        idx = load_index(f["release"], f["name"])
        mjd = week_mjd(name)
        with_det = {d: [v for v in f["versions"] if d in f["dets"].get(v, [])] for d in range(1, 7)}
        for obs, _exp, ra0, dec0, p11, p12, p21, p22, ref in idx["rows"]:
            if abs(dec0 - dec) > 12:  # cheap reject: the three patches span about +-6 deg
                continue
            t = _sky_to_tan(ra0, dec0, ra, dec)
            if not t:
                continue
            det = p11 * p22 - p12 * p21
            u, v = (p22 * t[0] - p12 * t[1]) / det, (-p21 * t[0] + p11 * t[1]) / det  # pixels from ref centre
            r0 = offs[(int(ref) - 1) % 3]
            for patch in (1, 2, 3):
                ox, oy = offs[patch - 1]
                if math.isnan(ox):
                    continue
                if abs(u - (ox - r0[0])) < NPIX / 2 + MARGIN and abs(v - (oy - r0[1])) < NPIX / 2 + MARGIN:
                    for exp in (1, 2, 3, 4):
                        for d in (patch, patch + 3):
                            if with_det[d]:
                                ids = [file_key(f, ver, int(obs), exp, d) for ver in with_det[d]]
                                out.append(
                                    {"ids": ids, "mjd_start": mjd + (exp - 1) * 0.0002, "found_via": "sky index"}
                                )
    return out
