"""
Pydantic schemas for GitHub repositories.
"""

from datetime import datetime
from pydantic import BaseModel


class RepositoryResponse(BaseModel):
    """Response model for a single repository."""
    id: str
    github_id: int
    name: str
    full_name: str
    description: str | None = None
    html_url: str
    stargazers_count: int
    language: str | None = None
    topics: list[str] = []
    owner_login: str
    owner_avatar_url: str | None = None
    starred_at: datetime | None = None
    github_updated_at: datetime | None = None


class SyncResponse(BaseModel):
    """Response model for sync operation."""
    total: int
    new_count: int
    updated_count: int
