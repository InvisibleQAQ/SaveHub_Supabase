"""Agentic-RAG 工具定义（Phase 1 骨架版）。"""

import asyncio
import logging
import threading
from uuid import UUID
from typing import Any, Dict, List, Optional

from supabase import Client

from app.services.ai import EmbeddingClient
from app.services.rag.retriever import search_all_embeddings

logger = logging.getLogger(__name__)


class AgenticRagTools:
    """Agentic-RAG 工具集合。"""

    def __init__(
        self,
        supabase: Client,
        user_id: str,
        embedding_client: Optional[EmbeddingClient] = None,
    ):
        self.supabase = supabase
        self.user_id = user_id
        self.embedding_client = embedding_client

    def search_embeddings_tool(
        self,
        query: str,
        top_k: int = 8,
        min_score: float = 0.35,
    ) -> List[Dict[str, Any]]:
        """检索 all_embeddings（结构化返回）。"""
        if not query.strip():
            return []

        if self.embedding_client is None:
            logger.warning("Embedding client not configured, returning empty hits")
            return []

        try:
            query_embedding = _run_async_in_thread(self.embedding_client.embed(query))
            hits = search_all_embeddings(
                supabase=self.supabase,
                query_embedding=query_embedding,
                user_id=self.user_id,
                top_k=top_k,
                min_score=min_score,
            )
            return [self._normalize_hit(hit) for hit in hits]
        except Exception as e:
            logger.error(f"search_embeddings_tool failed: {e}")
            raise

    def expand_context_tool(
        self,
        seed_query: str,
        seed_source_ids: Optional[List[str]] = None,
        window_size: int = 2,
        top_k: int = 4,
        min_score: float = 0.3,
    ) -> List[Dict[str, Any]]:
        """二次补全上下文：优先邻域扩展，失败时回退二次语义检索。"""
        if not seed_query.strip() and not seed_source_ids:
            return []

        normalized_seed_ids = self._normalize_uuid_list(seed_source_ids or [])
        neighborhood_hits = self._expand_by_neighborhood(
            seed_source_ids=normalized_seed_ids,
            window_size=window_size,
            limit=top_k,
        )

        if neighborhood_hits:
            return neighborhood_hits

        if not seed_query.strip():
            return []

        return self.search_embeddings_tool(query=seed_query, top_k=top_k, min_score=min_score)

    @staticmethod
    def _normalize_hit(hit: Dict[str, Any]) -> Dict[str, Any]:
        """统一来源结构，兼容 article/repository。"""
        is_article = bool(hit.get("article_id"))
        source_type = "article" if is_article else "repository"

        if is_article:
            title = hit.get("article_title") or "未知文章"
            url = hit.get("article_url")
        else:
            title = hit.get("repository_name") or "未知仓库"
            url = hit.get("repository_url")

        return {
            "id": str(hit.get("id") or ""),
            "article_id": str(hit.get("article_id") or "") or None,
            "repository_id": str(hit.get("repository_id") or "") or None,
            "chunk_index": int(hit.get("chunk_index") or 0),
            "content": hit.get("content", "")[:500],
            "score": float(hit.get("score") or 0.0),
            "source_type": source_type,
            "title": title,
            "url": url,
            "owner_login": hit.get("repository_owner_login"),
            "owner_avatar_url": hit.get("repository_owner_avatar_url"),
            "stargazers_count": hit.get("repository_stargazers_count"),
            "language": hit.get("repository_language"),
            "description": hit.get("repository_description"),
        }

    def _expand_by_neighborhood(
        self,
        seed_source_ids: List[str],
        window_size: int,
        limit: int,
    ) -> List[Dict[str, Any]]:
        """按 chunk 邻域补全上下文。"""
        if not seed_source_ids:
            return []

        try:
            seed_rows_result = (
                self.supabase.table("all_embeddings")
                .select("id, article_id, repository_id, chunk_index")
                .eq("user_id", self.user_id)
                .in_("id", seed_source_ids)
                .execute()
            )
            seed_rows = seed_rows_result.data or []
        except Exception as e:
            logger.warning(f"expand_context_tool seed lookup failed: {e}")
            return []

        expanded_rows: List[Dict[str, Any]] = []

        for row in seed_rows:
            source_field = "article_id" if row.get("article_id") else "repository_id"
            source_value = row.get(source_field)
            chunk_index = row.get("chunk_index")

            if not source_value or chunk_index is None:
                continue

            lower_bound = max(0, int(chunk_index) - max(0, int(window_size)))
            upper_bound = int(chunk_index) + max(0, int(window_size))

            try:
                query_result = (
                    self.supabase.table("all_embeddings")
                    .select(
                        "id, article_id, repository_id, chunk_index, content, "
                        "articles(title, url), "
                        "repositories(name, html_url, owner_login, owner_avatar_url, stargazers_count, language, description)"
                    )
                    .eq("user_id", self.user_id)
                    .eq(source_field, source_value)
                    .gte("chunk_index", lower_bound)
                    .lte("chunk_index", upper_bound)
                    .order("chunk_index")
                    .limit(limit)
                    .execute()
                )
                expanded_rows.extend(query_result.data or [])
            except Exception as e:
                logger.warning(
                    "expand_context_tool neighborhood query failed: %s (%s=%s)",
                    e,
                    source_field,
                    source_value,
                )

        deduped: Dict[str, Dict[str, Any]] = {}
        for row in expanded_rows:
            embedding_id = str(row.get("id") or "")
            if not embedding_id:
                continue
            deduped[embedding_id] = row

        normalized = [self._normalize_expand_row(hit) for hit in deduped.values()]
        normalized.sort(key=lambda item: item.get("chunk_index", 0))
        return normalized[: max(0, int(limit))]

    @staticmethod
    def _normalize_expand_row(hit: Dict[str, Any]) -> Dict[str, Any]:
        """将邻域查询结果转成统一 source 结构。"""
        article_id = hit.get("article_id")
        repository_id = hit.get("repository_id")
        article_info = hit.get("articles") or {}
        repository_info = hit.get("repositories") or {}

        if isinstance(article_info, list):
            article_info = article_info[0] if article_info else {}

        if isinstance(repository_info, list):
            repository_info = repository_info[0] if repository_info else {}

        if article_id:
            source_type = "article"
            title = article_info.get("title") or "未知文章"
            url = article_info.get("url")
        else:
            source_type = "repository"
            title = repository_info.get("name") or "未知仓库"
            url = repository_info.get("html_url")

        return {
            "id": str(hit.get("id") or ""),
            "article_id": str(article_id or "") or None,
            "repository_id": str(repository_id or "") or None,
            "chunk_index": int(hit.get("chunk_index") or 0),
            "content": (hit.get("content") or "")[:500],
            "score": 0.0,
            "source_type": source_type,
            "title": title,
            "url": url,
            "owner_login": repository_info.get("owner_login"),
            "owner_avatar_url": repository_info.get("owner_avatar_url"),
            "stargazers_count": repository_info.get("stargazers_count"),
            "language": repository_info.get("language"),
            "description": repository_info.get("description"),
        }

    @staticmethod
    def _normalize_uuid_list(values: List[str]) -> List[str]:
        """过滤无效 UUID 字符串，避免 Supabase 查询报错。"""
        normalized: List[str] = []
        for value in values:
            text = str(value or "").strip()
            if not text:
                continue
            try:
                normalized.append(str(UUID(text)))
            except Exception:
                continue
        return normalized


def _run_async_in_thread(coro):
    """在同步上下文中执行异步任务。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    holder: Dict[str, Any] = {}
    err_holder: Dict[str, Exception] = {}

    def _runner():
        try:
            holder["value"] = asyncio.run(coro)
        except Exception as exc:  # pragma: no cover
            err_holder["error"] = exc

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    thread.join()

    if "error" in err_holder:
        raise err_holder["error"]

    return holder.get("value")
