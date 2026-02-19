"""Feed Pydantic schemas for request/response validation."""

import logging
from pydantic import BaseModel, HttpUrl, field_validator
from typing import Literal, Optional
from datetime import datetime
from uuid import UUID

logger = logging.getLogger(__name__)


def _validate_image_url(v: Optional[str]) -> Optional[str]:
    """Validate feed image URL; return None for invalid values."""
    if v is None:
        return None
    if not isinstance(v, str):
        logger.debug("Invalid feed_image discarded: %s", v)
        return None
    if not v.lower().startswith(("http://", "https://")):
        logger.debug("Invalid feed_image discarded: %s", v)
        return None
    if len(v) > 2048:
        logger.debug("feed_image URL too long (%d), discarded", len(v))
        return None
    return v


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
    enable_auto_fetch_full_content: bool = False
    feed_image: Optional[str] = None

    @field_validator("feed_image", mode="before")
    @classmethod
    def validate_feed_image(cls, v: Optional[str]) -> Optional[str]:
        return _validate_image_url(v)


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
    enable_auto_fetch_full_content: Optional[bool] = None
    feed_image: Optional[str] = None

    @field_validator("feed_image", mode="before")
    @classmethod
    def validate_feed_image(cls, v: Optional[str]) -> Optional[str]:
        return _validate_image_url(v)


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
