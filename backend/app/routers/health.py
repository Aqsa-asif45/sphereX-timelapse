"""GET /api/health: is the API up, and which versions is it running."""

import astropy
from fastapi import APIRouter

from .. import __version__
from ..schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(ok=True, version=__version__, astropy=astropy.__version__)
