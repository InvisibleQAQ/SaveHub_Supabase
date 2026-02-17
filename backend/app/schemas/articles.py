"""Article Pydantic schemas for request/response validation."""

from pydantic import BaseModel
from typing import Literal, Optional, List
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
    full_content: Optional[str] = None
    full_content_fetched_at: Optional[datetime] = None
    fetch_status: Literal["unfetched", "success", "failed"] = "unfetched"


class ArticleCreate(ArticleBase):
    """Request model for creating an article."""
    id: UUID  # Client-generated UUID for upsert support


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
    repository_count: int = 0  # 关联仓库数量

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


class FetchFullContentRequest(BaseModel):
    """Request model for fetching full article content."""
    force_refresh: bool = False


class FetchFullContentResponse(BaseModel):
    """Response model for full content fetch result."""
    success: bool
    article_id: UUID
    source_url: str
    fetch_status: Literal["success", "cached"]
    cached: bool = False
    full_content: str
    full_content_fetched_at: datetime
    auto_show_all_content: bool
