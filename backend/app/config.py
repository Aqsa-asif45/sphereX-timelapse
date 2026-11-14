"""App settings and fixed constants.

Settings: every value has a default; any of them can be changed with an environment variable
of the same name (for example PORT=9000), or in a backend/.env file.
Constants: archive addresses and SPHEREx facts, checked against the live services.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8000
    # comma-separated list of frontend addresses allowed to call the API in development
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    cutout_concurrency: int = 32
    http_concurrency: int = 64
    max_exposures: int = 400
    cache_dir: Path = DATA_DIR / "cache"
    no_search_cache: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

# ── Archive addresses ────────────────────────────────────────────────
IRSA = "https://irsa.ipac.caltech.edu"
SIA_URL = f"{IRSA}/SIA"  # fast "which images cover this spot?" (about a day behind new data)
TAP_URL = f"{IRSA}/TAP/sync"  # slow but no lag; used as the fallback
IRSA_FILES = f"{IRSA}/ibe/data/spherex/"  # file URLs in search results start with this
S3_URL = "https://nasa-irsa-spherex.s3.amazonaws.com/"  # NASA's AWS copy: we read small byte ranges
MAST_URL = "https://mast.stsci.edu/api/v0/invoke"  # name lookup (asks SIMBAD and NED)
USER_AGENT = "spherex-timelens/0.1 (NASA Space Apps 2026 project)"

# SIA2 collection -> release. QR2 is no longer searchable at IRSA (DR1 + QR3 replace it).
# The "deep" collections hold the extra deep-survey exposures near the ecliptic poles (e.g. R Draconis).
COLLECTIONS = {
    "spherex_dr1": "dr1",
    "spherex_dr1_deep": "dr1",
    "spherex_qr3": "qr3",
    "spherex_qr3_deep": "qr3",
}

# ── SPHEREx facts ────────────────────────────────────────────────────
NPIX = 2040  # detector width and height, pixels
PIXEL_ARCSEC = 6.15
J2000_MJD = 51544.5
REF_MJD = 61040.0  # end of 2025: where a moving star is searched for (same as the old site)


def release_rank(release: str) -> int:
    """Higher is better: a Data Release beats a Quick Release, then the newer one wins (DR1 > QR3 > QR2)."""
    kind, num = release[:2], release[2:]
    if kind not in ("dr", "qr") or not num.isdigit():
        return -1
    return (1000 if kind == "dr" else 0) + int(num)
