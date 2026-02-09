"""Agentic-RAG 工具定义（Phase 1 骨架版）。"""

import asyncio
import logging
import threading
from typing import Any, Dict, List, Optional

from supabase import Client

from app.services.ai import EmbeddingClient
from app.services.rag.retriever import search_embeddings

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
            hits = search_embeddings(
                supabase=self.supabase,
                query_embedding=query_embedding,
                user_id=self.user_id,
                top_k=top_k,
                min_score=min_score,
            )
            return [self._normalize_hit(hit) for hit in hits]
        except Exception as e:
            logger.error(f"search_embeddings_tool failed: {e}")
            return []

    def expand_context_tool(
        self,
        seed_query: str,
        top_k: int = 4,
        min_score: float = 0.3,
    ) -> List[Dict[str, Any]]:
        """二次补全上下文（Phase 1 先复用向量检索）。"""
        if not seed_query.strip():
            return []

        return self.search_embeddings_tool(
            query=seed_query,
            top_k=top_k,
            min_score=min_score,
        )

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
