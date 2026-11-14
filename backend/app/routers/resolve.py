"""GET /api/resolve?q=...: a name or coordinates -> a sky position (plus proper motion when known)."""

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from ..services.resolver import resolve

router = APIRouter(tags=["search"])


@router.get("/resolve")
async def resolve_name(request: Request, q: str = Query("", max_length=200)) -> dict:
    try:
        return await resolve(request.app.state.http, q)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Name service unreachable ({type(e).__name__}). Try again.") from e
