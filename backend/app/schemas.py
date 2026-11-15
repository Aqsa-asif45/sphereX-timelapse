"""Pydantic models for API requests and responses."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    ok: bool
    version: str
    astropy: str
