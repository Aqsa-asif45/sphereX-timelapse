"""SPHEREx TimeLens API.

Run from the backend/ folder:
    .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
Interactive API docs: http://localhost:8000/api/docs
"""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import USER_AGENT, settings
from .routers import health, observations, resolve, targets


@asynccontextmanager
async def lifespan(app: FastAPI):
    # one shared HTTP client for every call to NASA, IRSA and MAST
    app.state.http = httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        timeout=httpx.Timeout(30, connect=10),
        limits=httpx.Limits(max_connections=settings.http_concurrency),
        follow_redirects=True,
    )
    yield
    await app.state.http.aclose()


app = FastAPI(
    title="SPHEREx TimeLens API",
    version=__version__,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
    lifespan=lifespan,
)

# lets the Vite dev server (port 5173) call the API directly if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

for r in (health, targets, resolve, observations):
    app.include_router(r.router, prefix="/api")
