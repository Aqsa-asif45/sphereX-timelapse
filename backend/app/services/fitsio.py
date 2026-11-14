"""Read only the parts of a SPHEREx file we need from NASA's AWS bucket, never the whole 65 MB file.

A spectral image file holds: PRIMARY, IMAGE, FLAGS, VARIANCE, ZODI, PSF/EPSF, WCS-WAVE (last).
  - Headers: the start of the file (IMAGE header: sky WCS, time) and the end (WCS-WAVE table).
  - Layout: where FLAGS and VARIANCE start (two more small header reads).
  - Pixels: the rows we need as one byte range (split into ~0.5 MB pieces for big fields). Measured on a
    home connection: AWS answers about 30 requests a second but sends about 2 MB/s, so a few larger
    reads are much faster than one small read per row.
  - FLAGS in DR1/QR3 are RICE_1 compressed, one tile per row: we read and decode only those rows.
Headers and layouts are cached on disk, so each file's headers are read once.
"""

import asyncio
import base64
import hashlib
import io
import json
import re
import warnings
from functools import lru_cache

import httpx
import numpy as np
from astropy import log as astropy_log
from astropy.io import fits
from astropy.io.fits.hdu.compressed._codecs import Rice1  # Astropy's own RICE_1 decoder
from astropy.wcs import WCS, FITSFixedWarning

from ..config import NPIX, S3_URL, settings
from .archive import KEY_RE

# Astropy prints an "Inconsistent SIP" note for every wavelength WCS we build. We remove those SIP
# terms on purpose (science rule 4), so the note is noise; real warnings still show.
astropy_log.setLevel("WARNING")

warnings.simplefilter("ignore", FITSFixedWarning)

BLOCK = 2880  # FITS files are made of 2880-byte blocks
HEAD_BYTES = BLOCK * 12  # enough for the PRIMARY + IMAGE headers seen so far (IMAGE data starts near 26 KB)
TAIL_BYTES = BLOCK * 10  # the WCS-WAVE table sits in the last few blocks
CACHE_VERSION = "h1"


class FileReadError(RuntimeError):
    """A file on AWS could not be read."""


class NotOnAws(FileReadError):
    """The file does not exist on AWS (for example: this processing version lacks that observation)."""


# network counters, shown by /api/status
net_stats = {"requests": 0, "bytes": 0, "retries": 0, "not_found": 0, "failed": 0}


async def read_range(client: httpx.AsyncClient, sem: asyncio.Semaphore, key: str, rng: str) -> tuple[bytes, int]:
    """GET one byte range ('bytes=0-99' or 'bytes=-100'). Returns the bytes and the full file size."""
    async with sem:
        for attempt in range(4):
            try:
                net_stats["requests"] += 1
                r = await client.get(S3_URL + key, headers={"Range": rng}, timeout=60)
                if r.status_code in (403, 404):
                    net_stats["not_found"] += 1
                    raise NotOnAws(f"Not on AWS: {key}")
                r.raise_for_status()
                net_stats["bytes"] += len(r.content)
                total = int(r.headers.get("content-range", "/0").rsplit("/", 1)[-1] or 0)
                return r.content, total
            except httpx.HTTPError as e:
                if attempt == 3:
                    net_stats["failed"] += 1
                    raise FileReadError(f"AWS read failed ({type(e).__name__}): {key}") from e
                net_stats["retries"] += 1
                await asyncio.sleep(0.8 * 2**attempt)
    raise FileReadError(key)  # not reached


def _header_end(buf: bytes, start: int) -> int | None:
    """Byte where the header starting at `start` ends (its END card + padding), or None if not in buf."""
    for pos in range(start, len(buf) - 79, 80):
        if buf[pos : pos + 80] == b"END" + b" " * 77:
            return (pos // BLOCK + 1) * BLOCK
    return None


def _cache_file(key: str):
    return settings.cache_dir / "headers" / (hashlib.sha1(f"{CACHE_VERSION}|{key}".encode()).hexdigest() + ".json")


async def file_header(client: httpx.AsyncClient, sem: asyncio.Semaphore, key: str) -> dict:
    """{'image_header': str, 'data_start': int, 'size': int, 'wave_hdu': base64 str} for one file (cached)."""
    if not KEY_RE.match(key):
        raise ValueError(f"Not a SPHEREx spectral image: {key}")
    path = _cache_file(key)
    if path.exists():
        return json.loads(path.read_text())

    head, size = await read_range(client, sem, key, f"bytes=0-{HEAD_BYTES - 1}")
    image_at = _header_end(head, 0)  # the IMAGE header follows the PRIMARY header
    data_start = _header_end(head, image_at) if image_at else None
    if data_start is None:  # an unusually long header: read more
        head, size = await read_range(client, sem, key, f"bytes=0-{BLOCK * 40 - 1}")
        image_at = _header_end(head, 0)
        data_start = _header_end(head, image_at) if image_at else None
    if data_start is None:
        raise FileReadError(f"IMAGE header not found: {key}")

    tail, size = await read_range(client, sem, key, f"bytes=-{TAIL_BYTES}")
    wave_at = None
    for i in range(0, len(tail) - BLOCK + 1, BLOCK):
        if tail[i : i + 9] == b"XTENSION=" and re.search(rb"EXTNAME = 'WCS-WAVE", tail[i : i + BLOCK * 3]):
            wave_at = i
    if wave_at is None:
        raise FileReadError(f"WCS-WAVE table not found at the end of {key}")

    info = {
        "image_header": head[image_at : _header_end(head, image_at)].decode("ascii"),
        "data_start": data_start,
        "size": size,
        "wave_hdu": base64.b64encode(tail[wave_at:]).decode(),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(info))
    return info


@lru_cache(maxsize=2048)
def sky_wcs(image_header: str) -> WCS:
    """The sky WCS (TAN-SIP) from the IMAGE header."""
    return WCS(fits.Header.fromstring(image_header))


@lru_cache(maxsize=2048)
def spectral_wcs(image_header: str, wave_hdu_b64: str) -> WCS:
    """The wavelength WCS (alternate key W, a lookup table in WCS-WAVE), with the sky SIP terms removed."""
    buf = io.BytesIO()
    fits.PrimaryHDU().writeto(buf)
    hdul = fits.HDUList.fromstring(buf.getvalue() + base64.b64decode(wave_hdu_b64))
    w = WCS(fits.Header.fromstring(image_header), fobj=hdul, key="W")
    w.sip = None  # SIP belongs to the sky WCS only (science rule 4)
    return w


# ── Layout: where FLAGS and VARIANCE start ───────────────────────────────

IMAGE_BYTES = NPIX * NPIX * 4  # IMAGE is 2040 x 2040 float32


def _padded(n: int) -> int:
    return -(-n // BLOCK) * BLOCK


def _data_bytes(h: fits.Header) -> int:
    """Size of an HDU's data on disk (including the heap of a binary table), padded to whole blocks."""
    if not h.get("NAXIS"):
        return 0
    n = abs(h["BITPIX"]) // 8
    for i in range(1, h["NAXIS"] + 1):
        n *= h[f"NAXIS{i}"]
    return _padded(n + h.get("PCOUNT", 0))


async def _header_at(client, sem, key: str, offset: int) -> tuple[fits.Header, int]:
    """The header that starts at byte `offset`, and the byte where its data starts."""
    for blocks in (12, 40):
        buf, _ = await read_range(client, sem, key, f"bytes={offset}-{offset + BLOCK * blocks - 1}")
        end = _header_end(buf, 0)
        if end:
            return fits.Header.fromstring(buf[:end].decode("ascii")), offset + end
    raise FileReadError(f"No header at byte {offset} of {key}")


def _flag_names(h: fits.Header) -> dict[str, str]:
    """Bit number (as text, e.g. "21") -> name, from MSKNnnnn cards (DR1/QR3) or MP_NAME = bit cards (QR2)."""
    names: dict[str, str] = {}
    for k in h:
        if m := re.fullmatch(r"MSKN(\d+)", k):
            names[str(int(m.group(1)))] = str(h[k]).strip()
        elif k.startswith("MP_") and isinstance(h[k], int):
            names.setdefault(str(h[k]), k[3:])
    return names


async def hdu_layout(client, sem, key: str) -> dict:
    """Where the FLAGS and VARIANCE data start, how FLAGS are stored, and the flag bit names (cached)."""
    path = settings.cache_dir / "layout" / (hashlib.sha1(f"{CACHE_VERSION}|{key}".encode()).hexdigest() + ".json")
    if path.exists():
        return json.loads(path.read_text())
    info = await file_header(client, sem, key)
    fh, fdata = await _header_at(client, sem, key, info["data_start"] + _padded(IMAGE_BYTES))
    if fh.get("EXTNAME") != "FLAGS":
        raise FileReadError(f"FLAGS not where expected in {key}")
    vh, vdata = await _header_at(client, sem, key, fdata + _data_bytes(fh))
    if vh.get("EXTNAME") != "VARIANCE" or vh.get("BITPIX") != -32:
        raise FileReadError(f"VARIANCE not where expected in {key}")
    compressed = bool(fh.get("ZIMAGE"))
    flags = {"data_start": fdata, "compressed": compressed, "names": _flag_names(fh)}
    if compressed:
        if fh.get("ZCMPTYPE") != "RICE_1" or fh.get("ZTILE1") != NPIX or fh.get("ZTILE2") != 1:
            raise FileReadError(f"Unexpected FLAGS compression in {key}")
        flags |= {
            "row_bytes": fh["NAXIS1"],
            "descriptor": ">i4" if fh["TFORM1"].lstrip("1").startswith("P") else ">i8",
            "heap": fh.get("THEAP", fh["NAXIS1"] * fh["NAXIS2"]),
            "blocksize": fh.get("ZVAL1", 32),
            "bytepix": fh.get("ZVAL2", 4),
        }
    layout = {"flags": flags, "variance": {"data_start": vdata}}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(layout))
    return layout


# ── Pixels ───────────────────────────────────────────────────────────────


ROWS_PER_READ = 64  # about 0.5 MB of a 2040-pixel float32 layer per request


async def read_block(client, sem, key: str, data_start: int, x0: int, x1: int, y0: int, y1: int, dtype=">f4"):
    """Pixels [y0..y1, x0..x1] (0-based, inclusive) of a plain 2040 x 2040 layer.

    Rows are read as contiguous byte ranges (from column x0 of the first row to column x1 of the last),
    up to ROWS_PER_READ rows per request, and the requested columns are cut out afterwards.
    """
    width, bytepix = x1 - x0 + 1, np.dtype(dtype).itemsize

    async def rows(ya: int, yb: int) -> np.ndarray:
        start = data_start + (ya * NPIX + x0) * bytepix
        length = ((yb - ya) * NPIX + width) * bytepix
        buf, _ = await read_range(client, sem, key, f"bytes={start}-{start + length - 1}")
        if len(buf) != length:
            raise FileReadError(f"Short read in {key}")
        flat = np.frombuffer(buf + b"\0" * ((NPIX - width) * bytepix), dtype)  # pad to whole rows
        return flat.reshape(yb - ya + 1, NPIX)[:, :width]

    pieces = [(ya, min(y1, ya + ROWS_PER_READ - 1)) for ya in range(y0, y1 + 1, ROWS_PER_READ)]
    return np.vstack(await asyncio.gather(*(rows(ya, yb) for ya, yb in pieces)))


async def read_flag_block(client, sem, key: str, flags: dict, x0: int, x1: int, y0: int, y1: int) -> np.ndarray:
    """FLAGS [y0..y1, x0..x1] as int32, for plain (QR2) or RICE_1-compressed (DR1/QR3) layers."""
    if not flags["compressed"]:
        return (await read_block(client, sem, key, flags["data_start"], x0, x1, y0, y1, ">i4")).astype(np.int32)
    rows = y1 - y0 + 1
    start = flags["data_start"] + y0 * flags["row_bytes"]
    raw, _ = await read_range(client, sem, key, f"bytes={start}-{start + rows * flags['row_bytes'] - 1}")
    desc = np.frombuffer(raw, flags["descriptor"]).reshape(rows, 2)  # (bytes, offset in heap) per row
    lo, hi = int(desc[:, 1].min()), int((desc[:, 1] + desc[:, 0]).max())
    heap = flags["data_start"] + flags["heap"]
    blob, _ = await read_range(client, sem, key, f"bytes={heap + lo}-{heap + hi - 1}")
    blob = np.frombuffer(blob, np.uint8)
    codec = Rice1(blocksize=flags["blocksize"], bytepix=flags["bytepix"], tilesize=NPIX)
    out = [np.asarray(codec.decode(blob[o - lo : o - lo + n]), dtype=np.int32)[x0 : x1 + 1] for n, o in desc]
    return np.vstack(out)
