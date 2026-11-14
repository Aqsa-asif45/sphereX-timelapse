"""Archive endpoints and release rules, verified against the live services on 2026-11-14 (see docs/RESEARCH.md)."""
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
CACHE = BACKEND / ".cache"
APP_DIST = ROOT / "app" / "dist"

IRSA = "https://irsa.ipac.caltech.edu"
SIA_URL = f"{IRSA}/SIA"
TAP_URL = f"{IRSA}/TAP/sync"
IBE_PREFIX = f"{IRSA}/ibe/data/spherex/"
S3 = "https://nasa-irsa-spherex.s3.amazonaws.com/"
HIPS_URL = f"{IRSA}/data/hips/SPHEREx/spherex_allsky_cube"
MAST_LOOKUP = "https://mast.stsci.edu/api/v0/invoke"

USER_AGENT = "spherex-timelens/0.2 (NASA Space Apps 2026 project)"

# SIA2 collections (release, survey). QR2 is no longer searchable at IRSA (superseded by DR1 + QR3).
COLLECTIONS: dict[str, tuple[str, str]] = {
    "spherex_dr1": ("dr1", "wide"),
    "spherex_dr1_deep": ("dr1", "deep"),
    "spherex_qr3": ("qr3", "wide"),
    "spherex_qr3_deep": ("qr3", "deep"),
}
DEFAULT_COLLECTIONS = ["spherex_dr1", "spherex_qr3"]

# a SPHEREx pixel is 6.15″; one pixel's solid angle in steradians
PIXEL_ARCSEC = 6.15


def release_rank(release: str) -> int:
    """Best release first: an official Data Release over a Quick Release, then the newer one."""
    m = re.fullmatch(r"(dr|qr)(\d+)", release)
    return (1000 if m.group(1) == "dr" else 0) + int(m.group(2)) if m else -1
