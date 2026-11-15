"""Command-line tools. Run from the backend/ folder:

.venv/Scripts/python -m app.cli build-index                  refresh the folder list, index weeks not indexed yet
.venv/Scripts/python -m app.cli build-index --weeks 2026W40_1A    only these weeks (any release)
.venv/Scripts/python -m app.cli build-index --folders-only   only refresh data/folders.json
.venv/Scripts/python -m app.cli warm                         pre-load the 5 challenge targets (search,
                                                             4' cutouts, home-page preview) for a fast demo
.venv/Scripts/python -m app.cli warm "R Dra" "M 101" --fov 6 other targets or field size (arcmin)
"""

import argparse
import asyncio
import sys
import time

import httpx

from .config import PIXEL_ARCSEC, REF_MJD, USER_AGENT, settings
from .services import indexer, skyindex
from .services.cutouts import get_cutout
from .services.frames import position_at, search
from .services.previews import build as build_preview
from .services.resolver import resolve
from .services.targets import BY_SLUG, TARGETS


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        timeout=httpx.Timeout(60, connect=10),
        limits=httpx.Limits(max_connections=settings.http_concurrency),
        follow_redirects=True,
    )


async def build_index(args) -> None:
    async with _client() as client:
        print("Listing week folders on AWS ...", flush=True)
        folders = await indexer.refresh_folders(client)
        print(f"{len(folders)} week folders in {len({f['release'] for f in folders})} releases")
        if args.folders_only:
            return
        todo = [f for f in folders if not skyindex.load_index(f["release"], f["name"])]
        if args.weeks:
            todo = [f for f in folders if f["name"] in args.weeks]
        print(f"Indexing {len(todo)} week folders (resumable: stop with Ctrl+C any time)")
        sem = asyncio.Semaphore(settings.http_concurrency)
        for i, f in enumerate(todo, 1):
            t0 = time.time()
            r = await indexer.index_week(client, sem, f)
            print(
                f"[{i}/{len(todo)}] {f['release']}/{f['name']}: {r['rows']} observations "
                f"({r['unreadable']} unreadable) in {time.time() - t0:.0f} s",
                flush=True,
            )
        print("Coverage:", skyindex.coverage())


async def warm(args) -> None:
    names = args.names or [t.slug for t in TARGETS]
    n = round(args.fov * 60 / PIXEL_ARCSEC) | 1  # odd, so the target sits on the centre pixel
    async with _client() as client:
        sem = asyncio.Semaphore(settings.http_concurrency)
        for name in names:
            t0 = time.time()
            try:
                t = await resolve(client, name)
                res = await search(client, t["ra"], t["dec"], t["epoch_mjd"], t.get("pmra"), t.get("pmdec"))
                star = (t["ra"], t["dec"], t["epoch_mjd"], t.get("pmra"), t.get("pmdec"))
                ra, dec = (round(v, 6) for v in position_at(*star, REF_MJD))
                limit = asyncio.Semaphore(settings.cutout_concurrency)
                ok = 0

                async def one(f, ra=ra, dec=dec, limit=limit):
                    async with limit:
                        # the same layers the Explore page asks for at this field size (image, flags, noise)
                        await get_cutout(client, sem, f["id"], ra, dec, n, PIXEL_ARCSEC, n <= 99, n <= 99)

                results = await asyncio.gather(*(one(f) for f in res["frames"]), return_exceptions=True)
                ok = sum(not isinstance(r, Exception) for r in results)
                note = ""
                if t.get("slug") in BY_SLUG and args.fov == 4:
                    await build_preview(client, sem, t["slug"])
                    note = ", preview built"
                print(
                    f"{t['name']}: {res['count']} frames via {'+'.join(res['sources']) or 'cache'}, "
                    f"{ok} cutouts ready{note} ({time.time() - t0:.0f} s)",
                    flush=True,
                )
            except Exception as e:  # noqa: BLE001 (report and carry on with the next target)
                print(f"{name}: failed ({type(e).__name__}: {e})", flush=True)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.cli", description="SPHEREx TimeLens tools")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build-index", help="refresh the folder list and index weeks not indexed yet")
    b.add_argument("--weeks", nargs="*", help="only these week names, e.g. 2026W40_1A")
    b.add_argument("--folders-only", action="store_true", help="only refresh data/folders.json")
    w = sub.add_parser("warm", help="pre-load targets (search, cutouts, previews) for a fast demo")
    w.add_argument("names", nargs="*", help="target names or coordinates (default: the 5 challenge targets)")
    w.add_argument("--fov", type=float, default=4, help="field of view in arcmin (default 4)")
    args = p.parse_args(argv)
    asyncio.run(build_index(args) if args.cmd == "build-index" else warm(args))
    return 0


if __name__ == "__main__":
    sys.exit(main())
