"""SPHEREx TimeLens v2 API (FastAPI). Run: python -m uvicorn app.main:app --app-dir backend --port 8010

  GET /api/v2/health                   service and library versions
  GET /api/v2/targets                  the five challenge targets (classification, checked positions)
  GET /api/v2/resolve?q=               name or coordinates → position
  GET /api/v2/observations?ra=&dec=    every SPHEREx exposure there (SIA2, TAP fallback), with provenance
  GET /api/v2/observations/stream      the same search as Server-Sent Events (progress, then the result)
  GET /api/v2/cutout?url=&ra=&dec=     a real cutout read with Astropy: image, flags, variance, WCS
"""
import asyncio
import json
from contextlib import asynccontextmanager

import astropy
import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, archive, coords, fitsio
from .config import APP_DIST, COLLECTIONS
from .targets import TARGETS


@asynccontextmanager
async def lifespan(app: FastAPI):
    limits = httpx.Limits(max_connections=32, max_keepalive_connections=16)
    app.state.http = httpx.AsyncClient(limits=limits, http2=False)
    yield
    await app.state.http.aclose()


app = FastAPI(title="SPHEREx TimeLens API", version=__version__, lifespan=lifespan, docs_url="/api/v2/docs", openapi_url="/api/v2/openapi.json")

RA = Query(..., ge=0, lt=360, description="Right ascension, degrees (ICRS)")
DEC = Query(..., ge=-90, le=90, description="Declination, degrees (ICRS)")


def _collections(value: str | None) -> list[str] | None:
    if not value:
        return None
    cols = [c.strip() for c in value.split(",") if c.strip()]
    bad = [c for c in cols if c not in COLLECTIONS]
    if bad:
        raise HTTPException(400, f"Unknown collection(s): {', '.join(bad)}. Known: {', '.join(COLLECTIONS)}.")
    return cols


@app.get("/api/v2/health")
async def health():
    return {"ok": True, "version": __version__, "astropy": astropy.__version__, "numpy": np.__version__}


@app.get("/api/v2/targets")
async def targets():
    return [t.public() for t in TARGETS]


@app.get("/api/v2/resolve")
async def resolve(request: Request, q: str = Query(..., max_length=500)):
    try:
        return await coords.resolve(request.app.state.http, q)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Name service unreachable ({type(e).__name__}).") from e


@app.get("/api/v2/observations")
async def observations(request: Request, ra: float = RA, dec: float = DEC, radius: float = Query(0.0005, gt=0, le=0.05),
                       collections: str | None = None):
    cols = _collections(collections)  # validate before any archive call
    res = await archive.search(request.app.state.http, ra, dec, radius, cols)
    if not res["count"] and res["errors"]:
        return JSONResponse(res, status_code=502)
    return res


@app.get("/api/v2/observations/stream")
async def observations_stream(request: Request, ra: float = RA, dec: float = DEC, radius: float = Query(0.0005, gt=0, le=0.05),
                              collections: str | None = None):
    cols = _collections(collections)
    queue: asyncio.Queue = asyncio.Queue()

    async def run():
        try:
            res = await archive.search(request.app.state.http, ra, dec, radius, cols, progress=queue.put_nowait)
            await queue.put({"type": "RESULT", "result": res})
        except Exception as e:  # noqa: BLE001 (reported to the client, never swallowed)
            await queue.put({"type": "SEARCH_FAILED", "error": f"{type(e).__name__}: {e}"})
        await queue.put(None)

    async def events():
        task = asyncio.create_task(run())
        try:
            while True:
                if await request.is_disconnected():
                    task.cancel()
                    return
                try:
                    e = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if e is None:
                    return
                yield f"event: {e['type']}\ndata: {json.dumps(e, default=str)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.get("/api/v2/cutout")
async def cutout(request: Request, url: str = Query(..., max_length=400), ra: float = RA, dec: float = DEC,
                 size: float = Query(0.1, ge=0.005, le=0.5, description="Cutout width, degrees")):
    try:
        return await fitsio.cutout(request.app.state.http, url, ra, dec, size)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except fitsio.CutoutError as e:
        raise HTTPException(502, str(e)) from e


# the built React app (app/dist), when present
if APP_DIST.exists():
    app.mount("/", StaticFiles(directory=APP_DIST, html=True), name="app")
