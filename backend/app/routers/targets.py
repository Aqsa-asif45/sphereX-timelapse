"""GET /api/targets: the five challenge targets."""

from fastapi import APIRouter

from ..services.targets import TARGETS

router = APIRouter(tags=["targets"])


@router.get("/targets")
def list_targets() -> list[dict]:
    return [t.public() for t in TARGETS]
