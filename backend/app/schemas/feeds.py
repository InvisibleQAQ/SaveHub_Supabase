"""Feed Pydantic schemas for request/response validation."""

from pydantic import BaseModel, HttpUrl
from typing import Optional
from datetime import datetime
from uuid import UUID


class FeedBase(BaseModel):
    """Base feed model with common fields."""
    title: str
    url: str
    description: Optional[str] = None
    category: Optional[str] = None
    folder_id: Optional[UUID] = None
    order: int = 0
    refresh_interval: int = 60
    enable_deduplication: bool = False


class FeedCreate(FeedBase):
    """Request model for creating a feed."""
    id: Optional[UUID] = None
    unread_count: int = 0
    last_fetched: Optional[datetime] = None
    last_fetch_status: Optional[str] = None
    last_fetch_error: Optional[str] = None


class FeedUpdate(BaseModel):
    """Request model for updating a feed (all fields optional)."""
    title: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    folder_id: Optional[UUID] = None
    order: Optional[int] = None
    unread_count: Optional[int] = None
    refresh_interval: Optional[int] = None
    last_fetched: Optional[datetime] = None
    last_fetch_status: Optional[str] = None
    last_fetch_error: Optional[str] = None
    enable_deduplication: Optional[bool] = None


class FeedResponse(FeedBase):
    """Response model for a feed."""
    id: UUID
    user_id: UUID
    unread_count: int = 0
    last_fetched: Optional[datetime] = None
    last_fetch_status: Optional[str] = None
    last_fetch_error: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FeedDeleteResponse(BaseModel):
    """Response model for feed deletion."""
    articles_deleted: int
    feed_deleted: bool
