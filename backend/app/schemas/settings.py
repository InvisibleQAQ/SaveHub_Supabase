"""Settings Pydantic schemas for request/response validation."""

from pydantic import BaseModel
from typing import Optional, Literal
from datetime import datetime


class SettingsBase(BaseModel):
    """Base settings model with common fields."""
    theme: Literal["light", "dark", "system"] = "system"
    font_size: int = 16
    auto_refresh: bool = True
    refresh_interval: int = 30
    articles_retention_days: int = 30
    mark_as_read_on_scroll: bool = False
    show_thumbnails: bool = True
    sidebar_pinned: bool = False


class SettingsCreate(SettingsBase):
    """Request model for creating settings."""
    pass


class SettingsUpdate(BaseModel):
    """Request model for updating settings (all fields optional)."""
    theme: Optional[Literal["light", "dark", "system"]] = None
    font_size: Optional[int] = None
    auto_refresh: Optional[bool] = None
    refresh_interval: Optional[int] = None
    articles_retention_days: Optional[int] = None
    mark_as_read_on_scroll: Optional[bool] = None
    show_thumbnails: Optional[bool] = None
    sidebar_pinned: Optional[bool] = None


class SettingsResponse(SettingsBase):
    """Response model for settings."""
    user_id: str
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Default settings
DEFAULT_SETTINGS = SettingsBase()
