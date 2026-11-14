"""Every SPHEREx exposure of a position.

GET /api/observations?ra=&dec=          the whole result as JSON
GET /api/observations/stream?ra=&dec=   the same search as Server-Sent Events:
    started, collection, fallback, progress ... then result (or error); a keep-alive every 15 s.
Optional: epoch_mjd, pmra, pmdec (mas/yr) so a moving star is placed correctly on each date.
"""

import asyncio
import json

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from ..config import J2000_MJD
from ..services.frames import search

router = APIRouter(tags=["search"])

RA = Query(..., ge=0, lt=360, description="Right ascension, degrees (ICRS)")
DEC = Query(..., ge=-90, le=90, description="Declination, degrees (ICRS)")
EPOCH = Query(J2000_MJD, ge=30000, le=80000, description="Epoch of ra/dec as MJD (J2000 = 51544.5)")
PM = Query(None, ge=-20000, le=20000, description="Proper motion, mas/yr")


@router.get("/observations")
async def observations(
    request: Request,
    ra: float = RA,
    dec: float = DEC,
    epoch_mjd: float = EPOCH,
    pmra: float | None = PM,
    pmdec: float | None = PM,
) -> dict:
    out = await search(request.app.state.http, ra, dec, epoch_mjd, pmra, pmdec)
    if not out["count"] and out["errors"]:
        raise HTTPException(502, f"The archive could not be searched: {'; '.join(out['errors'].values())}")
    return out


@router.get("/observations/stream")
async def observations_stream(
    request: Request,
    ra: float = RA,
    dec: float = DEC,
    epoch_mjd: float = EPOCH,
    pmra: float | None = PM,
    pmdec: float | None = PM,
) -> StreamingResponse:
    queue: asyncio.Queue = asyncio.Queue()

    async def run():
        try:
            result = await search(request.app.state.http, ra, dec, epoch_mjd, pmra, pmdec, queue.put_nowait)
            await queue.put({"type": "result", "result": result})
        except Exception as e:  # noqa: BLE001 (reported to the browser, never swallowed)
            await queue.put({"type": "error", "error": f"{type(e).__name__}: {e}"})
        await queue.put(None)

    async def events():
        task = asyncio.create_task(run())
        try:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if event is None:
                    return
                yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"}
    )
