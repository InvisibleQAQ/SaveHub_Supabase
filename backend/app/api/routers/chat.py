"""
Chat API 路由。

提供会话管理和 RAG 流式聊天功能。
"""

import json
import logging
from typing import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.dependencies import verify_auth, COOKIE_NAME_ACCESS
from app.exceptions import ConfigurationError
from app.supabase_client import get_supabase_client
from app.schemas.chat import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionUpdate,
    MessageResponse,
    RagChatWithSessionRequest,
)
from app.services.db.chat import ChatSessionService, MessageService
from app.services.db.api_configs import ApiConfigService
from app.services.ai.config import get_decrypted_config
from app.services.self_rag_service import SelfRagService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


def _get_services(request: Request, auth_response):
    """Get chat services with authenticated client."""
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    supabase = get_supabase_client(access_token)
    user_id = str(auth_response.user.id)
    return (
        ChatSessionService(supabase, user_id),
        MessageService(supabase, user_id),
        supabase,
        user_id,
    )


# =============================================================================
# Session CRUD
# =============================================================================


@router.get("/sessions", response_model=list[ChatSessionResponse])
async def list_sessions(
    request: Request,
    auth_response=Depends(verify_auth),
):
    """List all chat sessions for user."""
    session_svc, _, _, _ = _get_services(request, auth_response)
    return session_svc.get_sessions()


@router.post("/sessions", response_model=ChatSessionResponse)
async def create_session(
    request: Request,
    body: ChatSessionCreate,
    auth_response=Depends(verify_auth),
):
    """Create a new chat session."""
    session_svc, _, _, _ = _get_services(request, auth_response)
    session_id = str(body.id) if body.id else None
    if not session_id:
        import uuid
        session_id = str(uuid.uuid4())
    return session_svc.create_session(session_id, body.title)


@router.get("/sessions/{session_id}", response_model=list[MessageResponse])
async def get_session_messages(
    session_id: UUID,
    request: Request,
    auth_response=Depends(verify_auth),
):
    """Get all messages for a session."""
    session_svc, msg_svc, _, _ = _get_services(request, auth_response)

    session = session_svc.get_session(str(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return msg_svc.get_messages(str(session_id))


@router.patch("/sessions/{session_id}", response_model=ChatSessionResponse)
async def update_session(
    session_id: UUID,
    body: ChatSessionUpdate,
    request: Request,
    auth_response=Depends(verify_auth),
):
    """Update session (title)."""
    session_svc, _, _, _ = _get_services(request, auth_response)

    session = session_svc.get_session(str(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if body.title:
        session_svc.update_title(str(session_id), body.title)

    return session_svc.get_session(str(session_id))


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: UUID,
    request: Request,
    auth_response=Depends(verify_auth),
):
    """Delete a session and all its messages."""
    session_svc, _, _, _ = _get_services(request, auth_response)

    session = session_svc.get_session(str(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session_svc.delete_session(str(session_id))
    return {"detail": "Session deleted"}


# =============================================================================
# RAG Chat with Persistence
# =============================================================================


@router.post("/sessions/{session_id}/stream")
async def chat_stream(
    session_id: UUID,
    body: RagChatWithSessionRequest,
    request: Request,
    auth_response=Depends(verify_auth),
):
    """RAG chat with message persistence."""
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    supabase = get_supabase_client(access_token)
    user_id = str(auth_response.user.id)

    session_svc = ChatSessionService(supabase, user_id)
    msg_svc = MessageService(supabase, user_id)

    # Check if session exists, create if not
    session = session_svc.get_session(str(session_id))
    if not session:
        session = session_svc.create_session(str(session_id))

    # Save user message
    user_message = body.messages[-1]
    msg_svc.add_message(str(session_id), "user", user_message.content)

    # Get API configs
    config_svc = ApiConfigService(supabase, user_id)
    chat_config = config_svc.get_active_config("chat")
    if not chat_config:
        raise ConfigurationError("chat", "API")

    embedding_config = config_svc.get_active_config("embedding")
    if not embedding_config:
        raise ConfigurationError("embedding", "API")

    chat_config = get_decrypted_config(chat_config)
    embedding_config = get_decrypted_config(embedding_config)

    # Create RAG service
    rag_service = SelfRagService(
        chat_config=chat_config,
        embedding_config=embedding_config,
        supabase=supabase,
        user_id=user_id,
    )

    async def generate() -> AsyncGenerator[str, None]:
        """SSE generator with message persistence."""
        full_response = ""
        sources = []

        messages = [{"role": m.role, "content": m.content} for m in body.messages]

        try:
            async for event in rag_service.stream_chat(
                messages, body.top_k, body.min_score
            ):
                # Capture sources and content
                if event["event"] == "retrieval":
                    sources = event["data"].get("sources", [])
                elif event["event"] == "content":
                    full_response += event["data"].get("delta", "")
                elif event["event"] == "done":
                    # Save assistant message with sources
                    msg_svc.add_message(
                        str(session_id),
                        "assistant",
                        full_response,
                        sources if sources else None,
                    )
                    # Auto-generate title if first exchange
                    msg_count = msg_svc.count_messages(str(session_id))
                    if msg_count == 2:  # user + assistant
                        title = user_message.content[:50]
                        if len(user_message.content) > 50:
                            title += "..."
                        session_svc.update_title(str(session_id), title)

                yield f"event: {event['event']}\n"
                yield f"data: {json.dumps(event['data'], ensure_ascii=False)}\n\n"

        except Exception as e:
            logger.error(f"Chat stream error: {e}")
            yield f"event: error\n"
            yield f"data: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
