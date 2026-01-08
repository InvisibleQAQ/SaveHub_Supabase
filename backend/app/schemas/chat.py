"""Chat session and message schemas."""

from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# =============================================================================
# Message Schemas
# =============================================================================


class MessageBase(BaseModel):
    """Base message model."""

    role: Literal["user", "assistant"]
    content: str


class MessageCreate(MessageBase):
    """Request model for creating a message."""

    pass


class MessageResponse(MessageBase):
    """Response model for a message."""

    id: UUID
    session_id: UUID
    sources: Optional[List[dict]] = None
    created_at: datetime

    class Config:
        from_attributes = True


# =============================================================================
# Chat Session Schemas
# =============================================================================


class ChatSessionCreate(BaseModel):
    """Request model for creating a session."""

    id: Optional[UUID] = None
    title: str = "New Chat"


class ChatSessionUpdate(BaseModel):
    """Request model for updating a session."""

    title: Optional[str] = Field(None, min_length=1, max_length=200)


class ChatSessionResponse(BaseModel):
    """Response model for a chat session."""

    id: UUID
    user_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ChatSessionWithMessages(ChatSessionResponse):
    """Session with its messages."""

    messages: List[MessageResponse] = []


# =============================================================================
# RAG Chat Request (with session persistence)
# =============================================================================


class RagChatWithSessionRequest(BaseModel):
    """RAG Chat request with session persistence."""

    session_id: UUID
    messages: List[MessageBase] = Field(..., min_length=1)
    top_k: int = Field(default=10, ge=1, le=30)
    min_score: float = Field(default=0.3, ge=0.0, le=1.0)
