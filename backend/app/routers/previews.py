"""GET /api/previews/{slug}.gif: the looping home-page preview of a challenge target.

If it is not built yet, building starts in the background and the answer is 404 "not built yet"
(the home page shows a placeholder); `python -m app.cli warm` builds all five ahead of a demo.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from ..services.previews import preview_path, start_build
from ..services.targets import BY_SLUG

router = APIRouter(tags=["previews"])


@router.get("/previews/{name}")
async def get_preview(request: Request, name: str) -> FileResponse:
    slug = name.removesuffix(".gif")
    if not name.endswith(".gif") or slug not in BY_SLUG:  # only the five known slugs: no file paths
        raise HTTPException(404, "Unknown target.")
    path = preview_path(slug)
    if path.exists():
        # no-cache = check with the server each time (a cheap 304 via ETag): a rebuilt preview keeps its address,
        # so a long browser cache kept showing the old one
        return FileResponse(path, media_type="image/gif", headers={"Cache-Control": "no-cache"})
    start_build(request.app.state.http, request.app.state.s3, slug)
    raise HTTPException(404, "Preview not built yet; it is being made now. Try again in a few minutes.")
