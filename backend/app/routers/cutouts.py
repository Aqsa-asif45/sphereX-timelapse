"""Cutout endpoints.

GET  /api/cutouts/one?id=&ra=&dec=&n=&scale=&flags=&variance=   one cutout, binary
POST /api/cutouts/batch  {ids, ra, dec, n, scale, flags, variance}  many cutouts in one streamed response

Batch record format (little-endian), one per image, in the order they finish:
    u16 id length | u8 status (0 ok, 1 failed) | u32 payload length | id (UTF-8) | payload
"""

import asyncio
import struct

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from ..config import settings
from ..services.cutouts import get_cutout
from ..services.fitsio import FileReadError

router = APIRouter(tags=["cutouts"])

MAX_BODY = 100_000  # bytes; 400 ids fit easily


class BatchRequest(BaseModel):
    ids: list[str] = Field(..., max_length=400)
    ra: float = Field(..., ge=0, lt=360)
    dec: float = Field(..., ge=-90, le=90)
    n: int = Field(..., ge=8, le=400)
    scale: float = Field(6.15, ge=0.5, le=60, description="arcsec per output pixel")
    flags: bool = False
    variance: bool = False


def _headers(n: int, flags: bool, variance: bool) -> dict:
    return {"X-Size": str(n), "X-Flags": str(int(flags)), "X-Variance": str(int(variance))}


@router.get("/cutouts/one")
async def cutout_one(
    request: Request,
    id: str = Query(..., max_length=300),
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    n: int = Query(..., ge=8, le=400),
    scale: float = Query(6.15, ge=0.5, le=60),
    flags: bool = False,
    variance: bool = False,
) -> Response:
    try:
        data = await get_cutout(request.app.state.http, request.app.state.s3, id, ra, dec, n, scale, flags, variance)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except FileReadError as e:
        raise HTTPException(502, f"This exposure could not be read: {e}") from e
    headers = _headers(n, flags, variance) | {"Cache-Control": "private, max-age=31536000, immutable"}
    return Response(content=data, media_type="application/octet-stream", headers=headers)


@router.post("/cutouts/batch")
async def cutout_batch(request: Request) -> StreamingResponse:
    if int(request.headers.get("content-length") or 0) > MAX_BODY:
        raise HTTPException(413, "Too many images in one request.")
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "Too many images in one request.")
    try:
        req = BatchRequest.model_validate_json(body)
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False, include_input=False)) from e

    client, s3 = request.app.state.http, request.app.state.s3
    limit = asyncio.Semaphore(settings.cutout_concurrency)  # cutouts made at once for this request

    async def one(key: str) -> tuple[str, bytes | None]:
        async with limit:
            try:
                return key, await get_cutout(
                    client, s3, key, req.ra, req.dec, req.n, req.scale, req.flags, req.variance
                )
            except (ValueError, FileReadError):
                return key, None

    async def records():
        tasks = [asyncio.ensure_future(one(k)) for k in req.ids]
        try:
            for done in asyncio.as_completed(tasks):
                key, data = await done
                if await request.is_disconnected():
                    return  # the browser left: stop working
                idb = key.encode()
                # yielding waits until a slow client has taken the previous record (no pile-up in memory)
                yield struct.pack("<HBI", len(idb), 0 if data else 1, len(data or b"")) + idb + (data or b"")
        finally:
            for t in tasks:
                t.cancel()

    headers = _headers(req.n, req.flags, req.variance) | {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}
    return StreamingResponse(records(), media_type="application/octet-stream", headers=headers)
