"""
RAG API 路由。

提供 RAG 查询、重新索引和状态查询接口。
"""

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from app.dependencies import verify_auth, get_access_token, create_service_dependency
from app.supabase_client import get_supabase_client
from app.services.db.rag import RagService
from app.services.ai import EmbeddingClient, ChatClient, get_active_config, normalize_base_url
from app.services.rag.retriever import get_context_for_answer
from app.schemas.rag import (
    RagQueryRequest,
    RagQueryResponse,
    RagHit,
    RagStatusResponse,
    RagReindexRequest,
    RagReindexResponse,
    ArticleEmbeddingsResponse,
    EmbeddingItem,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rag", tags=["rag"])


# =============================================================================
# Dependencies
# =============================================================================

get_rag_service = create_service_dependency(RagService)


def get_active_configs(
    access_token: str = Depends(get_access_token),
    auth_response=Depends(verify_auth),
) -> dict:
    """
    获取用户的活跃 API 配置。

    Returns:
        {"chat": {...}, "embedding": {...}}

    Raises:
        HTTPException: 配置不存在
    """
    supabase = get_supabase_client(access_token)
    user_id = str(auth_response.user.id)

    configs = {}

    for config_type in ["chat", "embedding"]:
        config = get_active_config(supabase, user_id, config_type)
        if not config:
            raise HTTPException(
                status_code=400,
                detail=f"请先配置 {config_type} 类型的 API"
            )
        configs[config_type] = config

    return configs


# =============================================================================
# Endpoints
# =============================================================================

@router.post("/query", response_model=RagQueryResponse)
async def query_rag(
    query_request: RagQueryRequest,
    http_request: Request,
    rag_service: RagService = Depends(get_rag_service),
    auth_response=Depends(verify_auth),
):
    """
    RAG 查询接口。

    1. 将查询转为 embedding
    2. pgvector 相似度搜索
    3. 可选：使用 LLM 生成答案
    """
    try:
        # 获取配置
        configs = get_active_configs(http_request, auth_response)
        embedding_config = configs["embedding"]
        chat_config = configs["chat"]

        # 生成查询 embedding（异步）
        embedding_client = EmbeddingClient(**embedding_config)
        query_embedding = await embedding_client.embed(query_request.query)

        # 向量搜索
        hits = rag_service.search(
            query_embedding=query_embedding,
            top_k=query_request.top_k,
            feed_id=str(query_request.feed_id) if query_request.feed_id else None,
            min_score=query_request.min_score,
        )

        # 转换为响应模型
        hit_items = [
            RagHit(
                id=h["id"],
                article_id=h["article_id"],
                chunk_index=h["chunk_index"],
                content=h["content"],
                score=h.get("score", 0),
                article_title=h.get("article_title", ""),
                article_url=h.get("article_url", ""),
            )
            for h in hits
        ]

        # 可选：生成答案
        answer = None
        if query_request.generate_answer and hits:
            answer = await generate_answer(
                query=query_request.query,
                hits=hits,
                chat_config=chat_config,
            )

        return RagQueryResponse(
            query=query_request.query,
            hits=hit_items,
            answer=answer,
            total_hits=len(hit_items),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"RAG query failed: {e}")
        raise HTTPException(status_code=500, detail=f"查询失败: {str(e)}")


@router.get("/status", response_model=RagStatusResponse)
async def get_rag_status(
    rag_service: RagService = Depends(get_rag_service),
):
    """获取 RAG 索引状态"""
    try:
        stats = rag_service.get_rag_stats()
        return RagStatusResponse(**stats)
    except Exception as e:
        logger.exception(f"Failed to get RAG status: {e}")
        raise HTTPException(status_code=500, detail="获取状态失败")


@router.post("/reindex/{article_id}", response_model=RagReindexResponse)
async def reindex_article(
    article_id: UUID,
    request: RagReindexRequest = RagReindexRequest(),
    rag_service: RagService = Depends(get_rag_service),
    auth_response=Depends(verify_auth),
):
    """
    手动触发单篇文章重新索引。

    如果 force=True，会删除现有 embeddings 并重新处理。
    """
    from app.celery_app.rag_processor import process_article_rag

    user_id = auth_response.user.id
    article_id_str = str(article_id)

    try:
        if request.force:
            # 重置状态，允许重新处理
            rag_service.reset_article_rag_status(article_id_str)
            rag_service.delete_all_embeddings(article_id_str)

        # 创建处理任务
        task = process_article_rag.apply_async(
            kwargs={
                "article_id": article_id_str,
                "user_id": user_id,
            },
            queue="default",
        )

        return RagReindexResponse(
            success=True,
            article_id=article_id,
            message="重新索引任务已创建",
            task_id=task.id,
        )

    except Exception as e:
        logger.exception(f"Failed to reindex article {article_id}: {e}")
        raise HTTPException(status_code=500, detail=f"重新索引失败: {str(e)}")


@router.get("/embeddings/{article_id}", response_model=ArticleEmbeddingsResponse)
async def get_all_embeddings(
    article_id: UUID,
    rag_service: RagService = Depends(get_rag_service),
):
    """获取文章的所有 embeddings（不含向量数据）"""
    try:
        embeddings = rag_service.get_all_embeddings(str(article_id))

        items = [
            EmbeddingItem(
                id=e["id"],
                chunk_index=e["chunk_index"],
                content=e["content"],
                created_at=e["created_at"],
            )
            for e in embeddings
        ]

        return ArticleEmbeddingsResponse(
            article_id=article_id,
            embeddings=items,
            count=len(items),
        )

    except Exception as e:
        logger.exception(f"Failed to get embeddings for {article_id}: {e}")
        raise HTTPException(status_code=500, detail="获取 embeddings 失败")


# =============================================================================
# Helper Functions
# =============================================================================

async def generate_answer(
    query: str,
    hits: list,
    chat_config: dict,
    max_tokens: int = 4096,
) -> Optional[str]:
    """
    使用 LLM 根据检索结果生成答案。

    Args:
        query: 用户查询
        hits: 检索结果
        chat_config: Chat API 配置 {api_key, api_base, model}
        max_tokens: 最大生成 token 数

    Returns:
        生成的答案，失败时返回 None
    """
    try:
        context = get_context_for_answer(hits)

        if not context:
            return None

        system_prompt = """你是一个精准的问答助手。请基于提供的内容片段回答用户问题。

要求：
1. 只使用提供的内容片段中的信息
2. 引用来源时使用 [来源 N] 格式
3. 如果内容片段中没有相关信息，请明确说明
4. 回答要简洁、准确"""

        user_prompt = f"""问题：{query}

相关内容：
{context}

请基于以上内容回答问题。"""

        chat_client = ChatClient(**chat_config)
        response = await chat_client.complete(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=max_tokens,
        )

        return response

    except Exception as e:
        logger.warning(f"Failed to generate answer: {e}")
        return None
