"""Data-check endpoints.

GET /api/pixels?id=&x=&y=&r=  raw detector values around one pixel, no resampling
GET /api/flags?id=            the data-quality flag bit names written in that file (MSKNnnnn or MP_ cards)
"""

from fastapi import APIRouter, HTTPException, Query, Request

from ..services.archive import KEY_RE
from ..services.cutouts import raw_pixels
from ..services.fitsio import FileReadError, hdu_layout

router = APIRouter(tags=["cutouts"])


@router.get("/pixels")
async def pixels(
    request: Request,
    id: str = Query(..., max_length=300),
    x: int = Query(..., ge=1, le=2040, description="FITS pixel column (1-based)"),
    y: int = Query(..., ge=1, le=2040, description="FITS pixel row (1-based)"),
    r: int = Query(2, ge=0, le=10, description="radius in pixels"),
) -> dict:
    try:
        return await raw_pixels(request.app.state.http, request.app.state.s3, id, x, y, r)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except FileReadError as e:
        raise HTTPException(502, f"This exposure could not be read: {e}") from e


@router.get("/flags")
async def flag_names(request: Request, id: str = Query(..., max_length=300)) -> dict:
    """Bit number (as text) -> name, read from the file's own FLAGS header (cached with the file layout)."""
    if not KEY_RE.match(id):
        raise HTTPException(400, "Not a SPHEREx spectral image id.")
    try:
        layout = await hdu_layout(request.app.state.http, request.app.state.s3, id)
    except FileReadError as e:
        raise HTTPException(502, f"This exposure could not be read: {e}") from e
    flags = layout["flags"]
    return {"id": id, "names": flags["names"], "compressed": flags["compressed"]}
