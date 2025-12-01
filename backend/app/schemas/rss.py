"""RSS API Pydantic schemas for request/response validation."""

from pydantic import BaseModel, HttpUrl
from typing import Optional, List
from datetime import datetime
from uuid import UUID


# Request models
class ValidateRequest(BaseModel):
    """Request model for RSS URL validation."""
    url: HttpUrl


class ParseRequest(BaseModel):
    """Request model for RSS feed parsing."""
    url: HttpUrl
    feedId: UUID  # camelCase to match frontend


# Response models
class ValidateResponse(BaseModel):
    """Response model for RSS URL validation."""
    valid: bool


class ParsedFeed(BaseModel):
    """Parsed feed metadata."""
    title: str
    description: str
    link: str
    image: Optional[str] = None


class ParsedArticle(BaseModel):
    """Parsed article from RSS feed."""
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


class ParseResponse(BaseModel):
    """Response model for RSS feed parsing."""
    feed: ParsedFeed
    articles: List[ParsedArticle]
