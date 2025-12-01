"""Folder Pydantic schemas for request/response validation."""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID


class FolderBase(BaseModel):
    """Base folder model with common fields."""
    name: str
    order: int = 0


class FolderCreate(FolderBase):
    """Request model for creating a folder."""
    pass


class FolderBulkCreate(BaseModel):
    """Request model for bulk creating/updating folders."""
    folders: List["FolderCreateWithId"]


class FolderCreateWithId(FolderBase):
    """Folder with optional ID for upsert operations."""
    id: Optional[UUID] = None


class FolderUpdate(BaseModel):
    """Request model for updating a folder (all fields optional)."""
    name: Optional[str] = None
    order: Optional[int] = None


class FolderResponse(FolderBase):
    """Response model for a folder."""
    id: UUID
    user_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True
