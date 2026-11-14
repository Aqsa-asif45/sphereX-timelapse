"""Read just the headers of a SPHEREx file on NASA's AWS bucket, never the whole 65 MB file.

A spectral image file holds: PRIMARY, IMAGE, FLAGS, VARIANCE, ZODI, PSF, WCS-WAVE (last).
We read two small byte ranges per file:
  - the start (about 35 KB): the IMAGE header, with the sky WCS and the time;
  - the end (about 29 KB): the WCS-WAVE table, which gives the wavelength at each pixel.
Results are cached on disk, so each file is read once.
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
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning

from ..config import S3_URL, settings
from .archive import KEY_RE

warnings.simplefilter("ignore", FITSFixedWarning)

BLOCK = 2880  # FITS files are made of 2880-byte blocks
HEAD_BYTES = BLOCK * 12  # enough for the PRIMARY + IMAGE headers seen so far (IMAGE data starts near 26 KB)
TAIL_BYTES = BLOCK * 10  # the WCS-WAVE table sits in the last few blocks
CACHE_VERSION = "h1"


class FileReadError(RuntimeError):
    """A file on AWS could not be read."""


async def read_range(client: httpx.AsyncClient, sem: asyncio.Semaphore, key: str, rng: str) -> tuple[bytes, int]:
    """GET one byte range ('bytes=0-99' or 'bytes=-100'). Returns the bytes and the full file size."""
    async with sem:
        for attempt in range(4):
            try:
                r = await client.get(S3_URL + key, headers={"Range": rng}, timeout=45)
                if r.status_code in (403, 404):
                    raise FileReadError(f"Not on AWS: {key}")
                r.raise_for_status()
                total = int(r.headers.get("content-range", "/0").rsplit("/", 1)[-1] or 0)
                return r.content, total
            except httpx.HTTPError as e:
                if attempt == 3:
                    raise FileReadError(f"AWS read failed ({type(e).__name__}): {key}") from e
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
