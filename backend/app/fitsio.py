"""Real SPHEREx cutouts from IRSA's cutout service, read entirely with Astropy.

Returns the image (MJy/sr), the decoded FLAGS (Astropy decompresses DR1/QR3's RICE_1 tiles) with the
file's own bit names, the VARIANCE, and the sky and spectral WCS evaluated at the target.
"""
import asyncio
import base64
import hashlib
import io
import math
import re
import warnings

import httpx
import numpy as np
from astropy import log as astropy_log
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning

from .config import CACHE, IBE_PREFIX, USER_AGENT

astropy_log.setLevel("ERROR")
warnings.simplefilter("ignore", FITSFixedWarning)

INFO_FLAGS = {"SOURCE", "FULLSAMPLE"}
ARTIFACT_FLAGS = {"GHOST", "GHOST_FPA", "GHOST_EXT", "BLOOM", "SNOWBALL", "HALO"}


class CutoutError(RuntimeError):
    pass


def check_file_url(url: str) -> str:
    """Only SPHEREx files on IRSA's archive, no query strings or path tricks (the server fetches this URL)."""
    if not (url.startswith(IBE_PREFIX) and url.endswith(".fits") and "?" not in url and ".." not in url and "#" not in url):
        raise ValueError("Not a SPHEREx file URL on IRSA's archive.")
    return url


async def fetch_cutout(client: httpx.AsyncClient, url: str, ra: float, dec: float, size_deg: float) -> tuple[bytes, str, bool]:
    """Bytes of the cutout MEF, the URL asked for, and whether it came from the local cache."""
    check_file_url(url)
    cut_url = f"{url}?center={ra:.7f},{dec:.7f}d&size={size_deg:.5f}"
    path = CACHE / "cutouts" / (hashlib.sha1(cut_url.encode()).hexdigest() + ".fits")
    if path.exists() and path.stat().st_size > 2880:
        return path.read_bytes(), cut_url, True
    last = None
    for attempt in range(3):
        try:
            r = await client.get(cut_url, headers={"User-Agent": USER_AGENT}, timeout=120, follow_redirects=True)
            if r.status_code == 200 and r.content[:6] == b"SIMPLE":
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(r.content)
                return r.content, cut_url, False
            last = f"HTTP {r.status_code}"
            if r.status_code in (400, 404):
                break
        except httpx.HTTPError as e:
            last = type(e).__name__
        await asyncio.sleep(1.5 * (attempt + 1))
    raise CutoutError(f"IRSA cutout service failed ({last}).")


def flag_definitions(*headers) -> dict[int, dict]:
    """Bit number → name/description, from MSKNnnnn/MSKDnnnn cards (DR1/QR3) or MP_NAME = bit cards (QR2)."""
    defs: dict[int, dict] = {}
    for h in headers:
        for k in h:
            if m := re.fullmatch(r"MSKN(\d+)", k):
                defs.setdefault(int(m.group(1)), {})["name"] = str(h[k]).strip()
            elif m := re.fullmatch(r"MSKD(\d+)", k):
                defs.setdefault(int(m.group(1)), {})["description"] = str(h[k]).strip()
            elif (m := re.fullmatch(r"MP_(\w+)", k)) and isinstance(h[k], int):
                defs.setdefault(int(h[k]), {}).setdefault("name", m.group(1))
    for d in defs.values():
        n = d.get("name", "")
        d["category"] = "info" if n in INFO_FLAGS else "artifact" if n in ARTIFACT_FLAGS else "bad"
    return defs


def _b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def _fin(v) -> float | None:
    v = float(v)
    return v if math.isfinite(v) else None


def parse_cutout(content: bytes, ra: float, dec: float) -> dict:
    with fits.open(io.BytesIO(content), memmap=False) as hd:
        prim, im = hd[0].header, hd["IMAGE"]
        h = im.header
        img = np.asarray(im.data, dtype="<f4")
        fl_hdu = hd["FLAGS"]
        flags = np.asarray(fl_hdu.data).astype("<i4")
        var = np.asarray(hd["VARIANCE"].data, dtype="<f4") if "VARIANCE" in hd else None
        sky = WCS(h)
        x0, y0 = (float(v) for v in sky.world_to_pixel(SkyCoord(ra, dec, unit="deg")))
        spec = WCS(h, fobj=hd, key="W")
        spec.sip = None  # SIP belongs to the sky WCS only (as in IRSA's tutorial)
        lam, dlam = (float(v) for v in spec.pixel_to_world_values(x0, y0))
        spec_units = [str(u) for u in spec.wcs.cunit]
        # directions of north and east on the image, and a local linear WCS for hover read-outs
        def pix(r, d):
            return np.array([float(v) for v in sky.world_to_pixel(SkyCoord(r, d, unit="deg"))])
        step = 10 / 3600
        p0 = np.array([x0, y0])
        north = pix(ra, min(89.999, dec + step)) - p0
        east = pix(ra + step / max(1e-6, math.cos(math.radians(dec))), dec) - p0
        w00 = sky.pixel_to_world_values(x0, y0)
        w10 = sky.pixel_to_world_values(x0 + 1, y0)
        w01 = sky.pixel_to_world_values(x0, y0 + 1)
        cosd = math.cos(math.radians(float(w00[1])))
        cd = [[((float(w10[0]) - float(w00[0]) + 540) % 360 - 180) * cosd, ((float(w01[0]) - float(w00[0]) + 540) % 360 - 180) * cosd],
              [float(w10[1]) - float(w00[1]), float(w01[1]) - float(w00[1])]]
        defs = flag_definitions(fl_hdu.header, h)
        valid = flags >= 0
        counts = {b: int(((flags[valid] >> b) & 1).sum()) for b in defs}
        bad_mask = sum(1 << b for b, d in defs.items() if d["category"] == "bad")
        fin = img[np.isfinite(img)]
        med = float(np.median(fin)) if fin.size else float("nan")
        sig = float(1.4826 * np.median(np.abs(fin - med))) if fin.size else float("nan")
        lo, hi = (float(np.percentile(fin, p)) for p in (1, 99.5)) if fin.size else (float("nan"),) * 2
        # alternate WCS "A" is "0-based active pixel coordinates" of the original image, so IRSA's
        # 1 + x_cutout − CRPIX1A is a 0-based original pixel (checked: 841/841 pixels identical to the original file)
        crpix_a = (h.get("CRPIX1A"), h.get("CRPIX2A"))
        orig = [2 + x0 - crpix_a[0], 2 + y0 - crpix_a[1]] if None not in crpix_a else None
        keep = ("VERSION", "OBSID", "DETECTOR", "SURVEY", "PSURVEY", "TELESCOP", "INSTRUME")
        return {
            "shape": list(img.shape),
            "row0": "bottom (FITS convention: array row 0 is image row 1)",
            "image_b64": _b64(img), "flags_b64": _b64(flags), "variance_b64": _b64(var) if var is not None else None,
            "bunit": h.get("BUNIT"), "variance_unit": hd["VARIANCE"].header.get("BUNIT") if var is not None else None,
            "mjd_avg": h.get("MJD-AVG"), "timesys": h.get("TIMESYS"), "date_avg": h.get("DATE-AVG") or h.get("DATE-OBS"),
            "target_pixel_0based": [x0, y0], "target_pixel_original_1based": orig,
            "wavelength_um": lam, "bandwidth_um": dlam, "spectral_units": spec_units,
            "north_px": [_fin(north[0]), _fin(north[1])], "east_px": [_fin(east[0]), _fin(east[1])],
            "local_wcs": {"x0": x0, "y0": y0, "ra0": float(w00[0]), "dec0": float(w00[1]), "cd_deg_per_px": cd},
            "flags": {"definitions": {str(b): d for b, d in sorted(defs.items())}, "counts": {str(b): c for b, c in counts.items()},
                      "bad_mask": bad_mask, "compressed": isinstance(fl_hdu, fits.CompImageHDU)},
            "stats": {"median": _fin(med), "sigma_mad": _fin(sig), "p1": _fin(lo), "p99_5": _fin(hi), "nan_pixels": int((~np.isfinite(img)).sum())},
            "header": {k: prim.get(k, h.get(k)) for k in keep if (k in prim or k in h)},
            "hdus": [{"name": x.name, "type": type(x).__name__} for x in hd],
        }


async def cutout(client: httpx.AsyncClient, url: str, ra: float, dec: float, size_deg: float) -> dict:
    content, cut_url, cached = await fetch_cutout(client, url, ra, dec, size_deg)
    out = await asyncio.to_thread(parse_cutout, content, ra, dec)
    out.update(source_url=url, cutout_url=cut_url, from_cache=cached, size_deg=size_deg, ra=ra, dec=dec)
    return out
