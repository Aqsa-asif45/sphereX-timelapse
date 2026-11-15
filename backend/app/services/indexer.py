"""Build the local sky index from NASA's AWS bucket (used by `python -m app.cli build-index`).

1. List every week folder of every release, its processing versions (newest first) and detectors
   -> data/folders.json.
2. For each week without a complete index: list the observation numbers in every version and detector
   (the bucket listing, never guessed: numbering does not always start at 1), then read the first 20 KB
   of one exposure per observation for its pointing (CRVAL) and pixel matrix (PC). Those cards sit near
   10 KB in QR2 (v20) files but near 15 KB in QR3/DR1 (v27) files.
   -> data/index/<release>_<week>.json, one row [obs, exp, ra, dec, pc11, pc12, pc21, pc22, detector].
Resumable: complete weeks are skipped.
"""

import asyncio
import json
import re
from datetime import UTC, datetime
from xml.etree import ElementTree

import httpx

from ..config import DATA_DIR, S3_URL
from . import skyindex
from .fitsio import NotOnAws, read_range

_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
CARDS = ("CRVAL1", "CRVAL2", "PC1_1", "PC1_2", "PC2_1", "PC2_2")


async def list_prefixes(client, prefix: str, delimiter: str = "/") -> list[str]:
    """Sub-prefixes ("folders") under a prefix in the AWS bucket, following continuation pages."""
    out, token = [], None
    while True:
        params = {"list-type": "2", "prefix": prefix, "delimiter": delimiter}
        if token:
            params["continuation-token"] = token
        for attempt in range(4):
            try:
                r = await client.get(S3_URL, params=params, timeout=60)
                r.raise_for_status()
                break
            except httpx.HTTPError:
                if attempt == 3:
                    raise
                await asyncio.sleep(2 * (attempt + 1))
        root = ElementTree.fromstring(r.content)
        out += [p.text for p in root.iter(f"{_NS}Prefix") if p.text and p.text != prefix]
        token = root.findtext(f"{_NS}NextContinuationToken")
        if not token:
            return out


def version_order(v: str) -> tuple:
    """Newest first: pipeline version, then processing date, then a retry over the original run."""
    m = re.search(r"v(\d+)-(\d{4})-(\d{3})", v)
    return (-int(m[1]), -(int(m[2]) * 1000 + int(m[3])), 0 if "retry" in v else 1) if m else (0, 0, 1)


async def refresh_folders(client) -> list[dict]:
    releases = [p.rstrip("/") for p in await list_prefixes(client, "") if re.fullmatch(r"(dr|qr)\d+/", p)]
    out = []

    async def week(release: str, name: str):
        base = f"{release}/level2/{name}/"
        versions = sorted((p.split("/")[3] for p in await list_prefixes(client, base)), key=version_order)
        dets = {}
        for v in versions:
            dets[v] = sorted(
                int(p.split("/")[4]) for p in await list_prefixes(client, f"{base}{v}/") if p.split("/")[4].isdigit()
            )
        if versions:
            out.append({"release": release, "name": name, "base": base, "versions": versions, "dets": dets})

    for release in sorted(releases):
        names = [p.split("/")[2] for p in await list_prefixes(client, f"{release}/level2/")]
        await asyncio.gather(*(week(release, n) for n in names))
    out.sort(key=lambda f: (f["name"], f["release"]))
    doc = {"format": 3, "at": int(datetime.now(UTC).timestamp() * 1000), "folders": out}
    (DATA_DIR / "folders.json").write_text(json.dumps(doc))
    skyindex.folders.cache_clear()
    skyindex.load_index.cache_clear()
    skyindex.coverage.cache_clear()
    return out


def _coarse(buf: bytes) -> dict | None:
    """CRVAL and PC cards from the IMAGE header (which follows the 2880-byte PRIMARY header)."""
    got = {}
    for pos in range(2880, len(buf) - 79, 80):
        card = buf[pos : pos + 80].decode("ascii", "replace")
        k = card[:8].strip()
        if k in CARDS:
            got[k] = float(card[10:].split("/")[0])
        if k == "END":
            break
    return got if len(got) == len(CARDS) else None


async def index_week(client, sem, folder: dict, progress=None) -> dict:
    """Index one week folder (all versions, all detectors) and save it."""
    claimed: dict[int, tuple] = {}
    for version in folder["versions"]:  # newest first: an observation is read from the first place it appears
        for det in sorted(folder["dets"].get(version, [])):
            pre = f"{folder['base']}{version}/{det}/level2_{folder['name']}_"
            for p in await list_prefixes(client, pre, delimiter="_"):
                obs = p[len(pre) : -1]
                if obs.isdigit() and int(obs) not in claimed:
                    claimed[int(obs)] = (version, det)
    rows, unreadable = [], 0

    async def one(obs: int, version: str, det: int):
        nonlocal unreadable
        for exp in (1, 2, 3, 4):
            key = skyindex.file_key(folder, version, obs, exp, det)
            try:
                buf, _ = await read_range(client, sem, key, "bytes=0-20159")  # 7 blocks: covers v20 and v27
            except NotOnAws:
                continue
            c = _coarse(buf)
            if c:
                rows.append([obs, exp, c["CRVAL1"], c["CRVAL2"], c["PC1_1"], c["PC1_2"], c["PC2_1"], c["PC2_2"], det])
                if progress and len(rows) % 50 == 0:
                    progress(len(rows))
                return
        unreadable += 1

    await asyncio.gather(*(one(o, v, d) for o, (v, d) in claimed.items()))
    rows.sort()
    doc = {
        "format": 3,
        "release": folder["release"],
        "name": folder["name"],
        "versions": folder["versions"],
        "built": datetime.now(UTC).isoformat(),
        "rows": rows,
    }
    skyindex.INDEX_DIR.mkdir(parents=True, exist_ok=True)
    (skyindex.INDEX_DIR / f"{folder['release']}_{folder['name']}.json").write_text(json.dumps(doc))
    skyindex.load_index.cache_clear()
    skyindex.coverage.cache_clear()
    return {"rows": len(rows), "unreadable": unreadable}
