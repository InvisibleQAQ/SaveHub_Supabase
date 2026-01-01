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
    readme_content: str | None = None
    # AI analysis fields
    ai_summary: str | None = None
    ai_tags: list[str] = []
    ai_platforms: list[str] = []
    analyzed_at: datetime | None = None
    analysis_failed: bool = False
    # Custom edit fields
    custom_description: str | None = None
    custom_tags: list[str] = []
    custom_category: str | None = None
    last_edited: datetime | None = None


class SyncResponse(BaseModel):
    """Response model for sync operation."""
    total: int
    new_count: int
    updated_count: int


class RepositoryUpdateRequest(BaseModel):
    """Request model for updating repository custom fields."""
    custom_description: str | None = None
    custom_tags: list[str] | None = None
    custom_category: str | None = None


class AIAnalyzeResponse(BaseModel):
    """Response model for AI analysis."""
    ai_summary: str
    ai_tags: list[str]
    ai_platforms: list[str]
    analyzed_at: datetime
