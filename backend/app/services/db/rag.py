"""
RAG 数据库服务。

管理 all_embeddings 表的 CRUD 操作和查询。
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from supabase import Client

logger = logging.getLogger(__name__)


class RagService:
    """RAG 数据库操作服务"""

    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    # =========================================================================
    # Embedding CRUD
    # =========================================================================

    def save_embeddings(
        self,
        article_id: str,
        embeddings: List[Dict[str, Any]],
    ) -> int:
        """
        保存文章的 embeddings。

        会先删除该文章的现有 embeddings，再插入新的。

        Args:
            article_id: 文章 ID
            embeddings: embedding 数据列表，每个包含:
                - chunk_index: int
                - content: str
                - embedding: List[float]
                - metadata: Optional[dict]

        Returns:
            插入的记录数
        """
        if not embeddings:
            logger.warning(f"No embeddings to save for article {article_id}")
            return 0

        try:
            # 1. 删除现有 embeddings
            self.supabase.table("all_embeddings") \
                .delete() \
                .eq("article_id", article_id) \
                .eq("user_id", self.user_id) \
                .execute()

            # 2. 准备插入数据
            rows = []
            for emb in embeddings:
                row = {
                    "article_id": article_id,
                    "user_id": self.user_id,
                    "chunk_index": emb["chunk_index"],
                    "content": emb["content"],
                    "embedding": emb["embedding"],
                    "metadata": emb.get("metadata"),
                }
                rows.append(row)

            # 3. 批量插入
            result = self.supabase.table("all_embeddings") \
                .insert(rows) \
                .execute()

            count = len(result.data) if result.data else 0
            logger.info(
                f"Saved {count} embeddings for article {article_id}",
                extra={"user_id": self.user_id, "article_id": article_id}
            )
            return count

        except Exception as e:
            logger.error(f"Failed to save embeddings: {e}", extra={"article_id": article_id})
            raise

    def delete_all_embeddings(self, article_id: str) -> None:
        """
        删除文章的所有 embeddings。

        Args:
            article_id: 文章 ID
        """
        try:
            self.supabase.table("all_embeddings") \
                .delete() \
                .eq("article_id", article_id) \
                .eq("user_id", self.user_id) \
                .execute()

            logger.info(f"Deleted embeddings for article {article_id}")

        except Exception as e:
            logger.error(f"Failed to delete embeddings: {e}", extra={"article_id": article_id})
            raise

    def get_all_embeddings(self, article_id: str) -> List[Dict[str, Any]]:
        """
        获取文章的所有 embeddings（不含向量数据）。

        Args:
            article_id: 文章 ID

        Returns:
            embedding 记录列表
        """
        result = self.supabase.table("all_embeddings") \
            .select("id, chunk_index, content, created_at") \
            .eq("article_id", article_id) \
            .eq("user_id", self.user_id) \
            .order("chunk_index") \
            .execute()

        return result.data or []

    # =========================================================================
    # Article RAG Status
    # =========================================================================

    def mark_article_rag_processed(
        self,
        article_id: str,
        success: bool = True,
    ) -> None:
        """
        标记文章的 RAG 处理状态。

        Args:
            article_id: 文章 ID
            success: 是否处理成功
        """
        update_data = {
            "rag_processed": success,
            "rag_processed_at": datetime.now(timezone.utc).isoformat(),
        }

        self.supabase.table("articles") \
            .update(update_data) \
            .eq("id", article_id) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.debug(f"Marked article {article_id} rag_processed={success}")

    def reset_article_rag_status(self, article_id: str) -> None:
        """
        重置文章的 RAG 状态，允许重新处理。

        Args:
            article_id: 文章 ID
        """
        self.supabase.table("articles") \
            .update({
                "rag_processed": None,
                "rag_processed_at": None,
            }) \
            .eq("id", article_id) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Reset RAG status for article {article_id}")

    # =========================================================================
    # Statistics
    # =========================================================================

    def get_rag_stats(self) -> Dict[str, Any]:
        """
        获取 RAG 统计信息。

        Returns:
            包含以下字段的字典:
            - total_articles: 文章总数
            - rag_processed: 已处理的文章数
            - rag_pending: 待处理的文章数
            - total_embeddings: embedding 总数
        """
        try:
            # 文章统计
            articles_result = self.supabase.table("articles") \
                .select("id, rag_processed, images_processed", count="exact") \
                .eq("user_id", self.user_id) \
                .execute()

            total_articles = articles_result.count or 0
            rag_processed = sum(
                1 for a in (articles_result.data or [])
                if a.get("rag_processed") is True
            )
            rag_pending = sum(
                1 for a in (articles_result.data or [])
                if a.get("images_processed") is True and a.get("rag_processed") is None
            )

            # Embedding 统计
            embeddings_result = self.supabase.table("all_embeddings") \
                .select("id", count="exact") \
                .eq("user_id", self.user_id) \
                .execute()

            total_embeddings = embeddings_result.count or 0

            return {
                "total_articles": total_articles,
                "rag_processed": rag_processed,
                "rag_pending": rag_pending,
                "total_embeddings": total_embeddings,
            }

        except Exception as e:
            logger.error(f"Failed to get RAG stats: {e}")
            return {
                "total_articles": 0,
                "rag_processed": 0,
                "rag_pending": 0,
                "total_embeddings": 0,
            }

    # =========================================================================
    # Search
    # =========================================================================

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        feed_id: Optional[str] = None,
        min_score: float = 0.0,
    ) -> List[Dict[str, Any]]:
        """
        向量相似度搜索。

        Args:
            query_embedding: 查询向量
            top_k: 返回结果数量
            feed_id: 可选的 Feed ID 过滤
            min_score: 最小相似度阈值

        Returns:
            搜索结果列表
        """
        from app.services.rag.retriever import search_embeddings

        return search_embeddings(
            supabase=self.supabase,
            query_embedding=query_embedding,
            user_id=self.user_id,
            top_k=top_k,
            feed_id=feed_id,
            min_score=min_score,
        )

    # =========================================================================
    # Repository Embedding CRUD
    # =========================================================================

    def save_repository_embeddings(
        self,
        repository_id: str,
        embeddings: List[Dict[str, Any]],
    ) -> int:
        """
        保存仓库的 embeddings。

        跳过条件（满足任一则跳过）：
        1. readme_content 为空
        2. repository_id 已在 all_embeddings 表中存在
        """
        if not embeddings:
            logger.warning(f"No embeddings to save for repository {repository_id}")
            return 0

        try:
            # 检查 1: readme_content 是否为空
            repo_result = self.supabase.table("repositories") \
                .select("readme_content") \
                .eq("id", repository_id) \
                .eq("user_id", self.user_id) \
                .single() \
                .execute()

            if not repo_result.data or not repo_result.data.get("readme_content"):
                logger.info(f"Skip: repository {repository_id} has no readme_content")
                return 0

            # 检查 2: repository_id 是否已存在于 all_embeddings
            existing = self.supabase.table("all_embeddings") \
                .select("id") \
                .eq("repository_id", repository_id) \
                .eq("user_id", self.user_id) \
                .limit(1) \
                .execute()

            if existing.data and len(existing.data) > 0:
                logger.info(f"Skip: repository {repository_id} already has embeddings")
                return 0

            # 插入新的 embeddings
            rows = [{
                "repository_id": repository_id,
                "user_id": self.user_id,
                "chunk_index": emb["chunk_index"],
                "content": emb["content"],
                "embedding": emb["embedding"],
                "metadata": emb.get("metadata"),
            } for emb in embeddings]

            result = self.supabase.table("all_embeddings").insert(rows).execute()
            count = len(result.data) if result.data else 0
            logger.info(f"Saved {count} embeddings for repository {repository_id}")
            return count
        except Exception as e:
            logger.error(f"Failed to save repository embeddings: {e}")
            raise

    def delete_repository_embeddings(self, repository_id: str) -> None:
        """删除仓库的所有 embeddings。"""
        try:
            self.supabase.table("all_embeddings") \
                .delete() \
                .eq("repository_id", repository_id) \
                .eq("user_id", self.user_id) \
                .execute()
            logger.info(f"Deleted embeddings for repository {repository_id}")
        except Exception as e:
            logger.error(f"Failed to delete repository embeddings: {e}")
            raise

    def mark_repository_embedding_processed(
        self,
        repository_id: str,
        success: bool = True,
    ) -> None:
        """标记仓库的 embedding 处理状态。"""
        update_data = {
            "embedding_processed": success,
            "embedding_processed_at": datetime.now(timezone.utc).isoformat(),
        }

        self.supabase.table("repositories") \
            .update(update_data) \
            .eq("id", repository_id) \
            .eq("user_id", self.user_id) \
            .execute()
        logger.debug(f"Marked repository {repository_id} embedding_processed={success}")
