"""
Agentic-RAG Chat API 路由。

提供基于 Agentic-RAG 的智能问答接口，支持 SSE v2 流式响应。
"""

import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.dependencies import COOKIE_NAME_ACCESS, verify_auth
from app.schemas.agentic_rag_chat import AgenticRagChatRequest
from app.services.ai import ConfigError, get_required_ai_configs
from app.services.agentic_rag_service import AgenticRagService
from app.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agentic-rag", tags=["agentic-rag"])

SSE_V2_EVENTS = {
    "rewrite",
    "clarification_required",
    "tool_call",
    "tool_result",
    "aggregation",
    "content",
    "done",
    "error",
}

async def _sse_generator(
    service: AgenticRagService,
    request: AgenticRagChatRequest,
) -> AsyncGenerator[str, None]:
    """SSE v2 事件生成器。"""
    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    try:
        async for event in service.stream_chat(
            messages=messages,
            top_k=request.top_k,
            min_score=request.min_score,
            max_split_questions=request.max_split_questions,
            max_tool_rounds_per_question=request.max_tool_rounds_per_question,
            max_expand_calls_per_question=request.max_expand_calls_per_question,
            retry_tool_on_failure=request.retry_tool_on_failure,
            max_tool_retry=request.max_tool_retry,
        ):
            event_name = event.get("event")
            if event_name not in SSE_V2_EVENTS:
                continue

            yield f"event: {event_name}\n"
            yield f"data: {json.dumps(event.get('data', {}), ensure_ascii=False)}\n\n"
    except Exception as e:
        logger.error(f"Agentic-RAG SSE stream error: {e}")
        yield "event: error\n"
        yield f"data: {json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"


@router.post("/stream")
async def agentic_rag_chat_stream(
    request: Request,
    chat_request: AgenticRagChatRequest,
    auth_response=Depends(verify_auth),
):
    """
    Agentic-RAG 流式问答接口（SSE v2）。

    SSE 事件类型：
    - rewrite
    - clarification_required
    - tool_call
    - tool_result
    - aggregation
    - content
    - done
    - error
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    supabase = get_supabase_client(access_token)
    user_id = str(auth_response.user.id)

    try:
        configs = get_required_ai_configs(
            supabase=supabase,
            user_id=user_id,
            required_types=("chat", "embedding"),
        )
    except ConfigError as e:
        if "chat" in e.missing_types:
            raise HTTPException(status_code=400, detail="未配置 Chat API") from e
        if "embedding" in e.missing_types:
            raise HTTPException(status_code=400, detail="未配置 Embedding API") from e
        raise HTTPException(status_code=400, detail="AI 配置无效") from e

    chat_config = configs["chat"]
    embedding_config = configs["embedding"]

    service = AgenticRagService(
        chat_config=chat_config,
        embedding_config=embedding_config,
        supabase=supabase,
        user_id=user_id,
    )

    return StreamingResponse(
        _sse_generator(service, chat_request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
