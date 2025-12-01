"""
Chat API 路由

使用 Supabase Python SDK 进行数据库操作。
"""

from fastapi import APIRouter, Depends, HTTPException
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    MessageResponse,
    ChatSessionResponse,
    UpdateTitleRequest,
)
from app.services.chat_service import process_chat
from app.dependencies import verify_jwt
from app.supabase_client import get_supabase_client
from uuid import UUID
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


def get_user_client(user):
    """获取用户的 Supabase 客户端"""
    # 从 verify_jwt 返回的 user 对象获取 session
    # user.session.access_token 包含 JWT token
    access_token = None
    if hasattr(user, 'session') and user.session:
        access_token = user.session.access_token
    return get_supabase_client(access_token)


@router.get("/sessions/{session_id}", response_model=list[MessageResponse])
async def get_chat_history(session_id: UUID, user=Depends(verify_jwt)):
    """
    获取指定会话的所有消息

    Args:
        session_id: 会话 ID
        user: 已验证的用户

    Returns:
        消息列表
    """
    supabase = get_user_client(user)
    user_id = str(user.user.id)

    # 验证会话属于该用户
    session_response = supabase.table("chat_sessions") \
        .select("*") \
        .eq("id", str(session_id)) \
        .eq("user_id", user_id) \
        .execute()

    if not session_response.data:
        raise HTTPException(status_code=404, detail="Chat session not found")

    # 获取会话的所有消息
    messages_response = supabase.table("messages") \
        .select("*") \
        .eq("chat_session_id", str(session_id)) \
        .order("created_at", desc=False) \
        .execute()

    return messages_response.data


@router.post("/sessions/{session_id}", response_model=None)
async def continue_chat(
    session_id: UUID,
    chat_request: ChatRequest,
    user=Depends(verify_jwt)
):
    """
    向会话发送消息或创建新会话

    Args:
        session_id: 会话 ID
        chat_request: 聊天请求
        user: 已验证的用户

    Returns:
        流式响应
    """
    supabase = get_user_client(user)
    user_id = str(user.user.id)
    model_id = chat_request.model

    # 检查会话是否存在
    session_response = supabase.table("chat_sessions") \
        .select("*") \
        .eq("id", str(session_id)) \
        .eq("user_id", user_id) \
        .execute()

    if not session_response.data:
        # 创建新会话
        current_time = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        title = f"New Chat - {current_time}"

        supabase.table("chat_sessions").insert({
            "id": str(session_id),
            "user_id": user_id,
            "title": title,
        }).execute()

        logger.info(f"Created new chat session: {session_id} for user {user_id}")

    # 更新会话的 updated_at
    supabase.table("chat_sessions") \
        .update({"updated_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", str(session_id)) \
        .execute()

    # 添加用户消息
    user_message = chat_request.messages[-1].content
    supabase.table("messages").insert({
        "chat_session_id": str(session_id),
        "role": "user",
        "content": user_message,
    }).execute()

    # 处理聊天并返回流式响应
    return await process_chat(model_id, chat_request.messages, supabase, session_id)


@router.get("/sessions", response_model=list[ChatSessionResponse])
async def get_all_chat_sessions(user=Depends(verify_jwt)):
    """
    获取用户的所有聊天会话

    Args:
        user: 已验证的用户

    Returns:
        会话列表
    """
    supabase = get_user_client(user)
    user_id = str(user.user.id)

    response = supabase.table("chat_sessions") \
        .select("*") \
        .eq("user_id", user_id) \
        .order("updated_at", desc=True) \
        .execute()

    return response.data


@router.patch("/sessions/{session_id}/title", response_model=ChatSessionResponse)
async def update_chat_session_title(
    session_id: UUID,
    title_request: UpdateTitleRequest,
    user=Depends(verify_jwt),
):
    """
    更新会话标题

    Args:
        session_id: 会话 ID
        title_request: 新标题
        user: 已验证的用户

    Returns:
        更新后的会话
    """
    supabase = get_user_client(user)
    user_id = str(user.user.id)

    # 验证会话属于该用户
    session_response = supabase.table("chat_sessions") \
        .select("*") \
        .eq("id", str(session_id)) \
        .eq("user_id", user_id) \
        .execute()

    if not session_response.data:
        raise HTTPException(status_code=404, detail="Chat session not found")

    # 更新标题
    update_response = supabase.table("chat_sessions") \
        .update({"title": title_request.title}) \
        .eq("id", str(session_id)) \
        .execute()

    return update_response.data[0]


@router.delete("/sessions/{session_id}", response_model=dict)
async def delete_chat_session(
    session_id: UUID,
    user=Depends(verify_jwt),
):
    """
    删除会话及其所有消息

    Args:
        session_id: 会话 ID
        user: 已验证的用户

    Returns:
        删除确认
    """
    supabase = get_user_client(user)
    user_id = str(user.user.id)

    # 验证会话属于该用户
    session_response = supabase.table("chat_sessions") \
        .select("*") \
        .eq("id", str(session_id)) \
        .eq("user_id", user_id) \
        .execute()

    if not session_response.data:
        raise HTTPException(status_code=404, detail="Chat session not found")

    # 删除所有关联消息
    supabase.table("messages") \
        .delete() \
        .eq("chat_session_id", str(session_id)) \
        .execute()

    # 删除会话
    supabase.table("chat_sessions") \
        .delete() \
        .eq("id", str(session_id)) \
        .execute()

    logger.info(f"Deleted chat session: {session_id}")

    return {"detail": "Chat session and its messages have been deleted"}


@router.delete("/empty-sessions", response_model=dict)
async def empty_chat_sessions_and_messages(user=Depends(verify_jwt)):
    """
    清空用户的所有会话和消息

    警告：此操作不可逆

    Args:
        user: 已验证的用户

    Returns:
        删除确认
    """
    supabase = get_user_client(user)
    user_id = str(user.user.id)

    # 获取用户的所有会话 ID
    sessions_response = supabase.table("chat_sessions") \
        .select("id") \
        .eq("user_id", user_id) \
        .execute()

    session_ids = [s["id"] for s in sessions_response.data]

    if session_ids:
        # 删除所有关联消息
        for session_id in session_ids:
            supabase.table("messages") \
                .delete() \
                .eq("chat_session_id", session_id) \
                .execute()

        # 删除所有会话
        supabase.table("chat_sessions") \
            .delete() \
            .eq("user_id", user_id) \
            .execute()

    logger.info(f"Emptied all sessions for user: {user_id}")

    return {"detail": "All chat sessions and messages have been deleted"}
