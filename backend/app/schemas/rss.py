"""RSS Pydantic schemas for request/response validation.

Schemas for RSS feed validation and parsing endpoints.
Uses camelCase field names to match frontend expectations.
"""

from pydantic import BaseModel, HttpUrl, ConfigDict
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class ValidateRequest(BaseModel):
    """Request model for RSS URL validation."""
    url: HttpUrl


class ValidateResponse(BaseModel):
    """Response model for RSS URL validation."""
    valid: bool


class ParseRequest(BaseModel):
    """Request model for RSS feed parsing."""
    url: HttpUrl
    feedId: UUID

    model_config = ConfigDict(populate_by_name=True)


class ParsedFeed(BaseModel):
    """Parsed feed metadata."""
    title: str
    description: str
    link: str
    image: Optional[str] = None


class ParsedArticle(BaseModel):
    """Parsed article from RSS feed.

    Uses camelCase to match frontend Article type.
    """
    id: UUID
    feedId: UUID
    title: str
    content: str
    summary: str
    url: str
    author: Optional[str] = None
    publishedAt: datetime
    isRead: bool = False
    isStarred: bool = False
    thumbnail: Optional[str] = None
    contentHash: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class ParseResponse(BaseModel):
    """Response model for RSS feed parsing."""
    feed: ParsedFeed
    articles: List[ParsedArticle]
