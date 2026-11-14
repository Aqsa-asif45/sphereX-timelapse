"""GET /api/catalogs/{gaia|wise}?ra=&dec=&r=: stars from Gaia DR3 or CatWISE2020 around a position."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from ..services.catalogs import CatalogError, catalog

router = APIRouter(tags=["catalogues"])


@router.get("/catalogs/{cat}")
async def get_catalog(
    request: Request,
    cat: Literal["gaia", "wise"],
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    r: float = Query(..., ge=0.001, le=0.5, description="radius, degrees"),
) -> dict:
    try:
        return await catalog(request.app.state.http, cat, ra, dec, r)
    except CatalogError as e:
        name = "Gaia" if cat == "gaia" else "WISE"
        raise HTTPException(503, f"{name} catalogue unavailable right now ({e}).") from e
