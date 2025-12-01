"""Article Pydantic schemas for request/response validation."""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class ArticleBase(BaseModel):
    """Base article model with common fields."""
    feed_id: UUID
    title: str
    content: str
    summary: Optional[str] = None
    url: str
    author: Optional[str] = None
    published_at: datetime
    is_read: bool = False
    is_starred: bool = False
    thumbnail: Optional[str] = None
    content_hash: Optional[str] = None


class ArticleCreate(ArticleBase):
    """Request model for creating an article."""
    pass


class ArticleBulkCreate(BaseModel):
    """Request model for bulk creating articles."""
    articles: List[ArticleCreate]


class ArticleUpdate(BaseModel):
    """Request model for updating an article (all fields optional)."""
    title: Optional[str] = None
    content: Optional[str] = None
    summary: Optional[str] = None
    url: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[datetime] = None
    is_read: Optional[bool] = None
    is_starred: Optional[bool] = None
    thumbnail: Optional[str] = None


class ArticleResponse(ArticleBase):
    """Response model for an article."""
    id: UUID
    user_id: UUID
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ArticleStatsResponse(BaseModel):
    """Response model for article statistics."""
    total: int
    unread: int
    starred: int
    by_feed: dict  # Record<feed_id, { total: int, unread: int }>


class ClearOldArticlesResponse(BaseModel):
    """Response model for clearing old articles."""
    deleted_count: int
