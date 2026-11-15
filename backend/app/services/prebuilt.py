"""Pre-built demo data kept in git (backend/data/prebuilt/): the five challenge targets at the default 4' field
(searches, cutouts, previews, Gaia/CatWISE lists). On start-up, files missing from the cache are copied in,
so a fresh clone opens the targets in seconds without downloading. Refresh it with `app.cli warm` and the
script in docs (same cache file names: they are hashes of the request, identical on every machine).
"""

import shutil

from ..config import DATA_DIR, settings

PREBUILT = DATA_DIR / "prebuilt"


def seed_cache() -> int:
    """Copy pre-built files that are not in the cache yet. Returns how many were copied."""
    if not PREBUILT.is_dir():
        return 0
    copied = 0
    for src in PREBUILT.rglob("*"):
        if src.is_file():
            dst = settings.cache_dir / src.relative_to(PREBUILT)
            if not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)  # fresh time stamp: an offline-index search is then trusted for 1 h
                copied += 1
    return copied
