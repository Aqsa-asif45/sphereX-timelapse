"""GET /api/status: is IRSA reachable, how much the local sky index covers, and network counters."""

from fastapi import APIRouter, Request

from .. import __version__
from ..services.archive import irsa_reachable
from ..services.fitsio import net_stats
from ..services.skyindex import coverage

router = APIRouter(tags=["health"])


@router.get("/status")
async def status(request: Request) -> dict:
    return {
        "version": __version__,
        "irsa": await irsa_reachable(request.app.state.http),
        "coverage": coverage(),
        "net": dict(net_stats),
    }
