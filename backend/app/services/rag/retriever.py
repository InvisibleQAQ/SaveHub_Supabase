"""
向量检索服务。

使用 pgvector 进行向量相似度搜索，返回相关的文章片段。
"""

import logging
from typing import List, Optional, Dict, Any

from supabase import Client

logger = logging.getLogger(__name__)

SUPPORTED_SOURCE_TYPES = {"article", "repository"}


def _normalize_source_type(source_type: Optional[str]) -> Optional[str]:
    normalized = str(source_type or "").strip().lower()
    if not normalized:
        return None
    if normalized in SUPPORTED_SOURCE_TYPES:
        return normalized
    return None


def _filter_hits_by_source_type(
    hits: List[Dict[str, Any]],
    source_type: Optional[str],
) -> List[Dict[str, Any]]:
    if source_type == "article":
        return [hit for hit in hits if hit.get("article_id")]
    if source_type == "repository":
        return [hit for hit in hits if hit.get("repository_id")]
    return hits


def search_embeddings(
    supabase: Client,
    query_embedding: List[float],
    user_id: str,
    top_k: int = 10,
    feed_id: Optional[str] = None,
    min_score: float = 0.0,
    source_type: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    向量相似度搜索。

    使用 pgvector 的余弦距离操作符进行搜索。

    Args:
        supabase: Supabase 客户端
        query_embedding: 查询向量
        user_id: 用户 ID（数据隔离）
        top_k: 返回结果数量
        feed_id: 可选的 Feed ID 过滤
        min_score: 最小相似度阈值（0-1）
        source_type: 可选来源类型过滤（article/repository）

    Returns:
        搜索结果列表，每个结果包含：
        - id: embedding ID
        - article_id: 文章 ID
        - chunk_index: 块索引
        - content_type: 内容类型
        - content: 内容文本
        - score: 相似度分数 (0-1)
        - article_title: 文章标题
        - article_url: 文章 URL
    """
    if not query_embedding:
        logger.warning("Empty query embedding provided")
        return []

    normalized_source_type = _normalize_source_type(source_type)
    if source_type and normalized_source_type is None:
        logger.warning("Unknown source_type=%s, ignore source filter", source_type)

    rpc_args = {
        "query_embedding": query_embedding,
        "match_user_id": user_id,
        "match_count": top_k,
        "match_feed_id": feed_id,
        "min_similarity": min_score,
    }
    if normalized_source_type:
        rpc_args["match_source_type"] = normalized_source_type

    try:
        # 使用 RPC 调用执行向量搜索
        # 注意：需要在 Supabase 中创建对应的函数
        try:
            result = supabase.rpc("search_all_embeddings", rpc_args).execute()
        except Exception as exc:
            if not normalized_source_type:
                raise

            fallback_args = dict(rpc_args)
            fallback_args.pop("match_source_type", None)
            logger.warning(
                "Vector search source filter unavailable, fallback to client filter: %s",
                exc,
            )
            result = supabase.rpc("search_all_embeddings", fallback_args).execute()

        hits = result.data or []
        hits = _filter_hits_by_source_type(hits, normalized_source_type)

        logger.info(
            f"Vector search: user={user_id}, top_k={top_k}, "
            f"feed={feed_id}, source_type={normalized_source_type}, results={len(hits)}"
        )

        return hits

    except Exception as e:
        logger.error(f"Vector search failed: {e}")
        # 降级到简单查询（不使用向量搜索）
        return []


def search_all_embeddings(
    supabase: Client,
    query_embedding: List[float],
    user_id: str,
    top_k: int = 10,
    feed_id: Optional[str] = None,
    min_score: float = 0.0,
    source_type: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """语义检索 all_embeddings 的显式入口（Agentic-RAG 使用）。"""
    return search_embeddings(
        supabase=supabase,
        query_embedding=query_embedding,
        user_id=user_id,
        top_k=top_k,
        feed_id=feed_id,
        min_score=min_score,
        source_type=source_type,
    )


def search_embeddings_raw(
    supabase: Client,
    query_embedding: List[float],
    user_id: str,
    top_k: int = 10,
) -> List[Dict[str, Any]]:
    """
    原始 SQL 向量搜索（不使用 RPC）。

    当 RPC 函数不可用时使用此方法。

    Args:
        supabase: Supabase 客户端
        query_embedding: 查询向量
        user_id: 用户 ID
        top_k: 返回结果数量

    Returns:
        搜索结果列表
    """
    try:
        # 将向量转换为字符串格式
        vector_str = f"[{','.join(map(str, query_embedding))}]"

        # 使用 Supabase 的 select 查询（带原生 SQL 表达式）
        # 注意：这种方式可能不完全支持向量操作，建议使用 RPC
        result = supabase.table("all_embeddings") \
            .select(
                "id, article_id, chunk_index, content_type, content, source_url, "
                "articles(title, url)"
            ) \
            .eq("user_id", user_id) \
            .limit(top_k * 2) \
            .execute()  # 获取更多结果用于后续排序

        # 手动计算相似度并排序（效率较低，仅用于降级场景）
        hits = []
        for row in result.data or []:
            # 由于无法在客户端计算向量距离，这里只返回数据
            article_info = row.get("articles", {}) or {}
            hits.append({
                "id": row["id"],
                "article_id": row["article_id"],
                "chunk_index": row["chunk_index"],
                "content_type": row["content_type"],
                "content": row["content"],
                "source_url": row.get("source_url"),
                "article_title": article_info.get("title", ""),
                "article_url": article_info.get("url", ""),
                "score": 0.5,  # 无法计算实际分数
            })

        return hits[:top_k]

    except Exception as e:
        logger.error(f"Raw search failed: {e}")
        return []


def get_context_for_answer(
    hits: List[Dict[str, Any]],
    max_length: int = 6000,
) -> str:
    """
    将搜索结果打包为上下文文本，用于 LLM 生成答案。

    Args:
        hits: 搜索结果列表
        max_length: 最大字符数

    Returns:
        格式化的上下文字符串
    """
    if not hits:
        return ""

    context_parts = []
    current_length = 0

    for i, hit in enumerate(hits, 1):
        article_title = hit.get("article_title", "未知文章")
        content = hit.get("content", "")
        content_type = hit.get("content_type", "text")
        score = hit.get("score", 0)

        # 构建引用格式
        type_label = "图片描述" if content_type == "image_caption" else "文本"
        snippet = (
            f"[来源 {i}] ({type_label}, 相关度: {score:.2f})\n"
            f"文章: {article_title}\n"
            f"内容: {content[:500]}{'...' if len(content) > 500 else ''}\n"
        )

        if current_length + len(snippet) > max_length:
            break

        context_parts.append(snippet)
        current_length += len(snippet)

    return "\n---\n".join(context_parts)


# SQL 函数定义（需要在 Supabase 中执行）
SEARCH_FUNCTION_SQL = """
-- 创建向量搜索函数
CREATE OR REPLACE FUNCTION search_all_embeddings(
    query_embedding vector(1536),
    match_user_id uuid,
    match_count int DEFAULT 10,
    match_feed_id uuid DEFAULT NULL,
    min_similarity float DEFAULT 0.0,
    match_source_type text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    article_id uuid,
    repository_id uuid,
    chunk_index int,
    content text,
    score float,
    -- Article fields
    article_title text,
    article_url text,
    -- Repository fields (expanded for reference cards)
    repository_name text,
    repository_url text,
    repository_owner_login text,
    repository_owner_avatar_url text,
    repository_stargazers_count int,
    repository_language text,
    repository_description text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id,
        e.article_id,
        e.repository_id,
        e.chunk_index,
        e.content,
        1 - (e.embedding <=> query_embedding) AS score,
        -- Article fields
        a.title AS article_title,
        a.url AS article_url,
        -- Repository fields
        r.name AS repository_name,
        r.html_url AS repository_url,
        r.owner_login AS repository_owner_login,
        r.owner_avatar_url AS repository_owner_avatar_url,
        r.stargazers_count AS repository_stargazers_count,
        r.language AS repository_language,
        r.description AS repository_description
    FROM all_embeddings e
    LEFT JOIN articles a ON e.article_id = a.id
    LEFT JOIN repositories r ON e.repository_id = r.id
    WHERE e.user_id = match_user_id
      AND 1 - (e.embedding <=> query_embedding) >= min_similarity
      AND (
          match_source_type IS NULL
          OR lower(match_source_type) = ''
          OR (lower(match_source_type) = 'article' AND e.article_id IS NOT NULL)
          OR (lower(match_source_type) = 'repository' AND e.repository_id IS NOT NULL)
      )
      AND (
          match_feed_id IS NULL
          OR (e.article_id IS NOT NULL AND a.feed_id = match_feed_id)
          OR (
              e.repository_id IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM article_repositories ar
                  JOIN articles fa ON fa.id = ar.article_id
                  WHERE ar.repository_id = e.repository_id
                    AND ar.user_id = match_user_id
                    AND fa.user_id = match_user_id
                    AND fa.feed_id = match_feed_id
              )
          )
      )
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 授予执行权限
GRANT EXECUTE ON FUNCTION search_all_embeddings TO authenticated;
GRANT EXECUTE ON FUNCTION search_all_embeddings TO service_role;
"""
