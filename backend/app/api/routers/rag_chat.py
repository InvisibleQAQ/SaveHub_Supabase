"""
RAG Chat API 路由。

提供基于 Self-RAG 的智能问答接口，支持 SSE 流式响应。
"""

import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.dependencies import verify_auth, COOKIE_NAME_ACCESS
from app.exceptions import ConfigurationError
from app.supabase_client import get_supabase_client
from app.schemas.rag_chat import RagChatRequest
from app.services.self_rag_service import SelfRagService
from app.services.db.api_configs import ApiConfigService
from app.services.ai.config import get_decrypted_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rag-chat", tags=["rag-chat"])


async def _sse_generator(
    service: SelfRagService,
    request: RagChatRequest,
) -> AsyncGenerator[str, None]:
    """SSE 事件生成器。"""
    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    try:
        async for event in service.stream_chat(
            messages, request.top_k, request.min_score
        ):
            yield f"event: {event['event']}\n"
            yield f"data: {json.dumps(event['data'], ensure_ascii=False)}\n\n"
    except Exception as e:
        logger.error(f"SSE stream error: {e}")
        yield f"event: error\n"
        yield f"data: {json.dumps({'message': str(e)})}\n\n"


@router.post("/stream")
async def rag_chat_stream(
    request: Request,
    chat_request: RagChatRequest,
    auth_response=Depends(verify_auth),
):
    """
    Self-RAG 流式问答接口。

    SSE 事件类型：
    - decision: 检索决策结果
    - retrieval: 检索结果
    - content: 生成内容片段
    - assessment: 质量评估
    - done: 完成
    - error: 错误
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    supabase = get_supabase_client(access_token)
    user_id = str(auth_response.user.id)

    # 获取 API 配置
    config_service = ApiConfigService(supabase, user_id)

    chat_config = config_service.get_active_config("chat")
    if not chat_config:
        raise ConfigurationError("chat", "API")

    embedding_config = config_service.get_active_config("embedding")
    if not embedding_config:
        raise ConfigurationError("embedding", "API")

    # 解密配置
    chat_config = get_decrypted_config(chat_config)
    embedding_config = get_decrypted_config(embedding_config)

    # 创建服务
    service = SelfRagService(
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
