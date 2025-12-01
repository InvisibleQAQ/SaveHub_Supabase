"""API Config Pydantic schemas for request/response validation."""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class ApiConfigBase(BaseModel):
    """Base API config model with common fields."""
    name: str
    api_key: str
    api_base: str
    model: str
    is_default: bool = False
    is_active: bool = True


class ApiConfigCreate(ApiConfigBase):
    """Request model for creating an API config."""
    pass


class ApiConfigBulkCreate(BaseModel):
    """Request model for bulk creating/updating API configs."""
    configs: List["ApiConfigCreateWithId"]


class ApiConfigCreateWithId(ApiConfigBase):
    """API config with optional ID for upsert operations."""
    id: Optional[UUID] = None


class ApiConfigUpdate(BaseModel):
    """Request model for updating an API config (all fields optional)."""
    name: Optional[str] = None
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    model: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


class ApiConfigResponse(BaseModel):
    """Response model for an API config."""
    id: UUID
    user_id: UUID
    name: str
    api_key: str  # Will be decrypted
    api_base: str  # Will be decrypted
    model: str
    is_default: bool
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ApiConfigPublicResponse(BaseModel):
    """Response model for API config without sensitive data."""
    id: UUID
    name: str
    api_base: str  # Show base URL but not key
    model: str
    is_default: bool
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
