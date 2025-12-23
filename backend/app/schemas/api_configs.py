"""API Config Pydantic schemas for request/response validation.

Supports three API types: chat, embedding, rerank.
Each type can have multiple configs but only one active per user.
"""

from pydantic import BaseModel
from typing import Optional, List, Literal
from datetime import datetime
from uuid import UUID


# Type definition for API config types
ApiConfigType = Literal["chat", "embedding", "rerank"]


class ApiConfigBase(BaseModel):
    """Base API config model with common fields."""
    name: str
    api_key: str
    api_base: str
    model: str
    type: ApiConfigType = "chat"
    is_active: bool = True


class ApiConfigCreate(ApiConfigBase):
    """Request model for creating an API config."""
    pass


class ApiConfigUpdate(BaseModel):
    """Request model for updating an API config (all fields optional)."""
    name: Optional[str] = None
    api_key: Optional[str] = None
    api_base: Optional[str] = None
    model: Optional[str] = None
    type: Optional[ApiConfigType] = None
    is_active: Optional[bool] = None


class ApiConfigResponse(BaseModel):
    """Response model for an API config."""
    id: UUID
    user_id: UUID
    name: str
    api_key: str  # Will be decrypted before response
    api_base: str  # Will be decrypted before response
    model: str
    type: ApiConfigType
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ApiConfigsGroupedResponse(BaseModel):
    """Response model for API configs grouped by type."""
    chat: List[ApiConfigResponse]
    embedding: List[ApiConfigResponse]
    rerank: List[ApiConfigResponse]
