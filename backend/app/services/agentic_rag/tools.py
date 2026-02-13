"""Agentic-RAG 工具定义。"""

import asyncio
import logging
import re
import threading
from uuid import UUID
from typing import Any, Dict, List, Optional

from supabase import Client

from app.services.ai import EmbeddingClient
from app.services.rag.retriever import search_all_embeddings

logger = logging.getLogger(__name__)


class AgenticRagTools:
    """Agentic-RAG 工具集合。"""

    QUERY_TERM_PATTERN = re.compile(r"[a-z0-9][a-z0-9._-]{1,}|[\u4e00-\u9fff]{2,}")
    QUERY_STOP_TERMS = {
        "the",
        "and",
        "with",
        "for",
        "from",
        "what",
        "which",
        "when",
        "where",
        "how",
        "why",
        "is",
        "are",
        "to",
        "of",
        "in",
        "on",
        "at",
        "this",
        "that",
        "请问",
        "一下",
        "哪些",
        "什么",
        "一下子",
    }

    def __init__(
        self,
        supabase: Client,
        user_id: str,
        embedding_client: Optional[EmbeddingClient] = None,
        source_content_max_chars: int = 700,
    ):
        self.supabase = supabase
        self.user_id = user_id
        self.embedding_client = embedding_client
        self.source_content_max_chars = max(100, int(source_content_max_chars))
        self.semantic_fetch_multiplier = 5
        self.semantic_fetch_cap = 72
        self.semantic_backoff_step = 0.1
        self.semantic_backoff_rounds = 3
        self.semantic_backoff_floor = 0.0
        self.keyword_candidate_limit = 60

    def search_embeddings_tool(
        self,
        query: str,
        top_k: int = 8,
        min_score: float = 0.35,
    ) -> List[Dict[str, Any]]:
        """检索 all_embeddings（结构化返回 + 去重多样化）。"""
        if not query.strip():
            return []

        if self.embedding_client is None:
            logger.warning("Embedding client not configured, returning empty hits")
            return []

        safe_top_k = max(1, int(top_k))
        prefer_repository_query = self._prefer_repository_query(query)
        fetch_count = min(
            self.semantic_fetch_cap,
            max(safe_top_k * self.semantic_fetch_multiplier, safe_top_k + 12),
        )

        try:
            query_embedding = run_async_in_thread(self.embedding_client.embed(query))
            semantic_target_hits = max(safe_top_k * 2, safe_top_k + 2)

            article_semantic_hits = self._search_semantic_with_backoff(
                query_embedding=query_embedding,
                top_k=fetch_count,
                min_score=min_score,
                target_hits=semantic_target_hits,
                source_type="article",
            )

            repository_semantic_hits = self._search_semantic_with_backoff(
                query_embedding=query_embedding,
                top_k=fetch_count,
                min_score=min_score,
                target_hits=semantic_target_hits,
                source_type="repository",
            )

            semantic_hits = self._merge_semantic_hits(
                article_hits=article_semantic_hits,
                repository_hits=repository_semantic_hits,
                limit=max(fetch_count * 2, safe_top_k * 4),
            )
            normalized_semantic = [self._normalize_hit(hit) for hit in semantic_hits]

            keyword_hits = self._search_keyword_candidates(
                query=query,
                limit=max(safe_top_k * 3, min(fetch_count, self.keyword_candidate_limit)),
            )

            merged_sources = self._merge_recall_sources(
                semantic_sources=normalized_semantic,
                keyword_sources=keyword_hits,
                query=query,
            )

            reranked = self._diversify_sources(
                merged_sources,
                top_k=safe_top_k,
                prefer_breadth=self._prefer_breadth_query(query),
                prefer_repository=prefer_repository_query,
            )
            hydrated = self._hydrate_repository_full_text(reranked)
            return hydrated
        except Exception as exc:
            logger.error("search_embeddings_tool failed: %s", exc)
            raise

    def _search_semantic_with_backoff(
        self,
        query_embedding: List[float],
        top_k: int,
        min_score: float,
        target_hits: int,
        source_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """语义检索（自适应放宽阈值，优先提升召回）。"""
        thresholds: List[float] = []
        current_threshold = max(0.0, float(min_score))
        thresholds.append(current_threshold)

        for _ in range(max(0, int(self.semantic_backoff_rounds))):
            current_threshold = max(
                float(self.semantic_backoff_floor),
                current_threshold - float(self.semantic_backoff_step),
            )
            if current_threshold >= thresholds[-1]:
                continue
            thresholds.append(current_threshold)

        merged_hits: Dict[str, Dict[str, Any]] = {}
        safe_target_hits = max(1, int(target_hits))

        for threshold in thresholds:
            round_hits = search_all_embeddings(
                supabase=self.supabase,
                query_embedding=query_embedding,
                user_id=self.user_id,
                top_k=top_k,
                min_score=threshold,
                source_type=source_type,
            )

            for hit in round_hits:
                hit_id = str(hit.get("id") or "").strip()
                if not hit_id:
                    hit_id = (
                        f"{hit.get('article_id') or ''}:"
                        f"{hit.get('repository_id') or ''}:"
                        f"{hit.get('chunk_index') or 0}:"
                        f"{len(merged_hits)}"
                    )

                existing = merged_hits.get(hit_id)
                if existing is None:
                    merged_hits[hit_id] = hit
                    continue

                if float(hit.get("score") or 0.0) > float(existing.get("score") or 0.0):
                    merged_hits[hit_id] = hit

            if len(merged_hits) >= safe_target_hits:
                break

        ordered_hits = list(merged_hits.values())
        ordered_hits.sort(
            key=lambda item: (-(float(item.get("score") or 0.0)), int(item.get("chunk_index") or 0))
        )
        return ordered_hits

    @staticmethod
    def _merge_semantic_hits(
        article_hits: List[Dict[str, Any]],
        repository_hits: List[Dict[str, Any]],
        limit: int,
    ) -> List[Dict[str, Any]]:
        """合并 article/repository 语义召回结果并按分数排序去重。"""
        deduped: Dict[str, Dict[str, Any]] = {}

        for hit in [*article_hits, *repository_hits]:
            hit_id = str(hit.get("id") or "").strip()
            if not hit_id:
                hit_id = (
                    f"{hit.get('article_id') or ''}:"
                    f"{hit.get('repository_id') or ''}:"
                    f"{hit.get('chunk_index') or 0}:"
                    f"{len(deduped)}"
                )

            existing = deduped.get(hit_id)
            if existing is None:
                deduped[hit_id] = hit
                continue

            if float(hit.get("score") or 0.0) > float(existing.get("score") or 0.0):
                deduped[hit_id] = hit

        ordered_hits = list(deduped.values())
        ordered_hits.sort(
            key=lambda item: (-(float(item.get("score") or 0.0)), int(item.get("chunk_index") or 0))
        )
        return ordered_hits[: max(1, int(limit))]

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

        safe_top_k = max(1, int(top_k))
        normalized_seed_ids = self._normalize_uuid_list(seed_source_ids or [])
        neighborhood_hits = self._expand_by_neighborhood(
            seed_source_ids=normalized_seed_ids,
            window_size=window_size,
            limit=safe_top_k * 2,
        )

        if neighborhood_hits:
            return self._diversify_sources(neighborhood_hits, top_k=safe_top_k)

        if not seed_query.strip():
            return []

        return self.search_embeddings_tool(query=seed_query, top_k=safe_top_k, min_score=min_score)

    def _normalize_hit(self, hit: Dict[str, Any]) -> Dict[str, Any]:
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
            "content": (hit.get("content") or "")[: self.source_content_max_chars],
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

    def _hydrate_repository_full_text(self, sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """将 repository 来源的 content 替换为 all_embeddings 全量分块拼接文本。"""
        if not sources:
            return []

        repository_ids_raw = [str(item.get("repository_id") or "").strip() for item in sources]
        repository_ids = self._normalize_uuid_list([item for item in repository_ids_raw if item])
        if not repository_ids:
            return sources

        try:
            repository_chunk_rows = self._fetch_repository_chunk_rows(repository_ids)
        except Exception as exc:
            logger.warning("hydrate repository full_text failed: %s", exc)
            return sources

        repository_chunk_map: Dict[str, List[Dict[str, Any]]] = {}
        for row in repository_chunk_rows:
            repository_id = str(row.get("repository_id") or "").strip()
            if not repository_id:
                continue
            repository_chunk_map.setdefault(repository_id, []).append(row)

        repository_context_map: Dict[str, str] = {}
        for repository_id, chunk_rows in repository_chunk_map.items():
            ordered_rows = sorted(
                chunk_rows,
                key=lambda item: int(item.get("chunk_index") or 0),
            )
            combined_content = "".join(str(item.get("content") or "") for item in ordered_rows)
            if combined_content:
                repository_context_map[repository_id] = combined_content

        if not repository_context_map:
            return sources

        hydrated_sources: List[Dict[str, Any]] = []
        for source in sources:
            repository_id = str(source.get("repository_id") or "").strip()
            repository_content = repository_context_map.get(repository_id)
            if not repository_id or not repository_content:
                hydrated_sources.append(source)
                continue

            hydrated_source = dict(source)
            hydrated_source["content"] = repository_content

            hydrated_sources.append(hydrated_source)

        return hydrated_sources

    def _fetch_repository_chunk_rows(self, repository_ids: List[str]) -> List[Dict[str, Any]]:
        """分页读取指定仓库在 all_embeddings 中的全部分块。"""
        rows: List[Dict[str, Any]] = []
        page_size = 1000
        start = 0

        while True:
            page_result = (
                self.supabase.table("all_embeddings")
                .select("repository_id, chunk_index, content")
                .eq("user_id", self.user_id)
                .in_("repository_id", repository_ids)
                .order("repository_id")
                .order("chunk_index")
                .range(start, start + page_size - 1)
                .execute()
            )
            page_rows = page_result.data or []
            if not page_rows:
                break

            rows.extend(page_rows)

            if len(page_rows) < page_size:
                break

            start += page_size

        return rows

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
        except Exception as exc:
            logger.warning("expand_context_tool seed lookup failed: %s", exc)
            return []

        expanded_rows: List[Dict[str, Any]] = []
        safe_window = max(0, int(window_size))
        safe_limit = max(1, int(limit))

        for row in seed_rows:
            source_field = "article_id" if row.get("article_id") else "repository_id"
            source_value = row.get(source_field)
            chunk_index = row.get("chunk_index")

            if not source_value or chunk_index is None:
                continue

            lower_bound = max(0, int(chunk_index) - safe_window)
            upper_bound = int(chunk_index) + safe_window

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
                    .limit(safe_limit)
                    .execute()
                )
                expanded_rows.extend(query_result.data or [])
            except Exception as exc:
                logger.warning(
                    "expand_context_tool neighborhood query failed: %s (%s=%s)",
                    exc,
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
        for item in normalized:
            item["content"] = (item.get("content") or "")[: self.source_content_max_chars]
        normalized.sort(key=lambda item: (int(item.get("chunk_index") or 0), -(float(item.get("score") or 0.0))))
        return normalized[:safe_limit]

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
            title = (
                repository_info.get("name")
                or repository_info.get("full_name")
                or "未知仓库"
            )
            url = repository_info.get("html_url")

        return {
            "id": str(hit.get("id") or ""),
            "article_id": str(article_id or "") or None,
            "repository_id": str(repository_id or "") or None,
            "chunk_index": int(hit.get("chunk_index") or 0),
            "content": (hit.get("content") or "")[:700],
            "score": 0.48,
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

    @staticmethod
    def _source_family(source: Dict[str, Any]) -> str:
        article_id = str(source.get("article_id") or "").strip()
        repository_id = str(source.get("repository_id") or "").strip()
        if article_id:
            return f"article:{article_id}"
        if repository_id:
            return f"repository:{repository_id}"
        return f"embedding:{source.get('id') or ''}"

    def _diversify_sources(
        self,
        sources: List[Dict[str, Any]],
        top_k: int,
        prefer_breadth: bool = False,
        prefer_repository: bool = False,
    ) -> List[Dict[str, Any]]:
        """在高分前提下增加来源多样性，减少同源重复。"""
        if not sources:
            return []

        safe_top_k = max(1, int(top_k))
        sorted_sources = sorted(
            sources,
            key=lambda item: (-(float(item.get("score") or 0.0)), int(item.get("chunk_index") or 0)),
        )

        per_family_limit = 1 if prefer_breadth else (2 if safe_top_k >= 6 else 1)
        family_count: Dict[str, int] = {}
        selected: List[Dict[str, Any]] = []

        for source in sorted_sources:
            family = self._source_family(source)
            used = family_count.get(family, 0)
            if used >= per_family_limit:
                continue
            family_count[family] = used + 1
            selected.append(source)
            if len(selected) >= safe_top_k:
                break

        if len(selected) < safe_top_k:
            selected_ids = {item.get("id") for item in selected}
            for source in sorted_sources:
                if source.get("id") in selected_ids:
                    continue
                selected.append(source)
                if len(selected) >= safe_top_k:
                    break

        if prefer_repository and selected:
            selected = self._ensure_repository_presence(
                selected=selected,
                sorted_sources=sorted_sources,
                top_k=safe_top_k,
            )

        return selected[:safe_top_k]

    @staticmethod
    def _source_type_of(source: Dict[str, Any]) -> str:
        source_type = str(source.get("source_type") or "").strip().lower()
        if source_type in {"article", "repository"}:
            return source_type
        if source.get("repository_id"):
            return "repository"
        if source.get("article_id"):
            return "article"
        return ""

    def _ensure_repository_presence(
        self,
        selected: List[Dict[str, Any]],
        sorted_sources: List[Dict[str, Any]],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """当查询偏向项目/仓库时，确保最终结果至少保留一个 repository 来源。"""
        has_repo_in_candidates = any(
            self._source_type_of(item) == "repository" for item in sorted_sources
        )
        if not has_repo_in_candidates:
            return selected[:top_k]

        has_repo_selected = any(self._source_type_of(item) == "repository" for item in selected)
        if has_repo_selected:
            return selected[:top_k]

        selected_ids = {str(item.get("id") or "") for item in selected}
        best_repository = None
        for candidate in sorted_sources:
            if self._source_type_of(candidate) != "repository":
                continue

            candidate_id = str(candidate.get("id") or "")
            if candidate_id and candidate_id in selected_ids:
                continue

            best_repository = candidate
            break

        if best_repository is None:
            return selected[:top_k]

        replace_index = None
        replace_score = float("inf")
        for idx, item in enumerate(selected):
            if self._source_type_of(item) == "repository":
                continue

            item_score = float(item.get("score") or 0.0)
            if item_score < replace_score:
                replace_score = item_score
                replace_index = idx

        updated = list(selected)
        if replace_index is not None:
            updated[replace_index] = best_repository
        elif len(updated) < top_k:
            updated.append(best_repository)

        updated.sort(
            key=lambda item: (-(float(item.get("score") or 0.0)), int(item.get("chunk_index") or 0))
        )
        return updated[:top_k]

    def _search_keyword_candidates(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """关键词兜底召回（content + repository metadata）。"""
        terms = self._extract_query_terms(query)
        if not terms:
            return []

        safe_limit = max(1, int(limit))
        prefer_repository = self._prefer_repository_query(query)
        rows: List[Dict[str, Any]] = []

        rows.extend(self._search_content_keyword_rows(terms=terms, limit=safe_limit))
        rows.extend(
            self._search_repository_keyword_rows(
                terms=terms,
                limit=safe_limit,
                prefer_repository=prefer_repository,
            )
        )

        deduped_rows: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            source_id = str(row.get("id") or "").strip()
            if not source_id:
                continue
            deduped_rows[source_id] = row

        normalized = [self._normalize_expand_row(row) for row in deduped_rows.values()]
        for item in normalized:
            item["content"] = (item.get("content") or "")[: self.source_content_max_chars]
            item["score"] = self._keyword_match_score(item, terms)

        normalized.sort(
            key=lambda item: (-(float(item.get("score") or 0.0)), int(item.get("chunk_index") or 0))
        )
        return normalized[:safe_limit]

    def _search_content_keyword_rows(self, terms: List[str], limit: int) -> List[Dict[str, Any]]:
        """基于 embedding chunk 内容做关键词召回。"""
        clauses: List[str] = []
        for term in terms[:4]:
            escaped = self._escape_ilike_term(term)
            if escaped:
                clauses.append(f"content.ilike.%{escaped}%")

        if not clauses:
            return []

        try:
            result = (
                self.supabase.table("all_embeddings")
                .select(
                    "id, article_id, repository_id, chunk_index, content, "
                    "articles(title, url), "
                    "repositories(name, full_name, html_url, owner_login, owner_avatar_url, stargazers_count, language, description)"
                )
                .eq("user_id", self.user_id)
                .or_(",".join(clauses))
                .limit(limit)
                .execute()
            )
            return result.data or []
        except Exception as exc:
            logger.warning("keyword content recall query failed: %s", exc)
            return []

    def _search_repository_keyword_rows(
        self,
        terms: List[str],
        limit: int,
        prefer_repository: bool = False,
    ) -> List[Dict[str, Any]]:
        """基于仓库 metadata 先召回 repo，再映射到 embeddings。"""
        basic_clauses: List[str] = []
        extended_clauses: List[str] = []
        for term in terms[:4]:
            escaped = self._escape_ilike_term(term)
            if not escaped:
                continue
            basic_clauses.extend(
                [
                    f"name.ilike.%{escaped}%",
                    f"full_name.ilike.%{escaped}%",
                    f"description.ilike.%{escaped}%",
                ]
            )

            extended_clauses.extend(
                [
                    f"name.ilike.%{escaped}%",
                    f"full_name.ilike.%{escaped}%",
                    f"description.ilike.%{escaped}%",
                    f"ai_summary.ilike.%{escaped}%",
                    f"custom_description.ilike.%{escaped}%",
                ]
            )

        if not basic_clauses:
            return []

        primary_clauses = extended_clauses if prefer_repository else basic_clauses

        try:
            repository_rows = (
                self.supabase.table("repositories")
                .select("id")
                .eq("user_id", self.user_id)
                .or_(",".join(primary_clauses))
                .limit(max(10, limit))
                .execute()
            ).data or []
        except Exception as exc:
            if prefer_repository and primary_clauses != basic_clauses:
                logger.warning(
                    "keyword repository recall with extended fields failed, fallback to basic fields: %s",
                    exc,
                )
                try:
                    repository_rows = (
                        self.supabase.table("repositories")
                        .select("id")
                        .eq("user_id", self.user_id)
                        .or_(",".join(basic_clauses))
                        .limit(max(10, limit))
                        .execute()
                    ).data or []
                except Exception as fallback_exc:
                    logger.warning("keyword repository recall query failed: %s", fallback_exc)
                    return []
            else:
                logger.warning("keyword repository recall query failed: %s", exc)
                return []

        repository_ids = [str(row.get("id") or "").strip() for row in repository_rows if row.get("id")]
        repository_ids = [item for item in repository_ids if item]
        if not repository_ids:
            return []

        try:
            result = (
                self.supabase.table("all_embeddings")
                .select(
                    "id, article_id, repository_id, chunk_index, content, "
                    "articles(title, url), "
                    "repositories(name, full_name, html_url, owner_login, owner_avatar_url, stargazers_count, language, description)"
                )
                .eq("user_id", self.user_id)
                .in_("repository_id", repository_ids)
                .order("chunk_index")
                .limit(max(limit, len(repository_ids) * 2))
                .execute()
            )
            return result.data or []
        except Exception as exc:
            logger.warning("keyword repository to embedding mapping failed: %s", exc)
            return []

    def _merge_recall_sources(
        self,
        semantic_sources: List[Dict[str, Any]],
        keyword_sources: List[Dict[str, Any]],
        query: str,
    ) -> List[Dict[str, Any]]:
        """融合语义召回与关键词召回，统一去重后排序。"""
        terms = self._extract_query_terms(query)
        merged: Dict[str, Dict[str, Any]] = {}

        def _source_key(source: Dict[str, Any]) -> str:
            source_id = str(source.get("id") or "").strip()
            if source_id:
                return f"id:{source_id}"

            article_id = str(source.get("article_id") or "").strip()
            if article_id:
                return f"article:{article_id}:{source.get('chunk_index') or 0}"

            repository_id = str(source.get("repository_id") or "").strip()
            if repository_id:
                return f"repository:{repository_id}:{source.get('chunk_index') or 0}"

            content = str(source.get("content") or "").strip()
            return f"content:{content[:120]}" if content else ""

        def _ingest(source: Dict[str, Any]) -> None:
            source_key = _source_key(source)
            if not source_key:
                return

            candidate = dict(source)
            if terms:
                candidate["score"] = self._keyword_match_score(candidate, terms)

            existing = merged.get(source_key)
            if existing is None:
                merged[source_key] = candidate
                return

            existing_score = float(existing.get("score") or 0.0)
            candidate_score = float(candidate.get("score") or 0.0)

            if candidate_score >= existing_score:
                preferred, fallback = candidate, existing
            else:
                preferred, fallback = existing, candidate

            merged_source = dict(preferred)
            for field in (
                "title",
                "url",
                "description",
                "language",
                "owner_login",
                "owner_avatar_url",
                "stargazers_count",
                "article_id",
                "repository_id",
                "source_type",
            ):
                if not merged_source.get(field):
                    merged_source[field] = fallback.get(field)

            if len(str(fallback.get("content") or "")) > len(str(merged_source.get("content") or "")):
                merged_source["content"] = (fallback.get("content") or "")[: self.source_content_max_chars]

            merged[source_key] = merged_source

        for source in semantic_sources:
            _ingest(source)

        for source in keyword_sources:
            _ingest(source)

        merged_list = list(merged.values())
        merged_list.sort(
            key=lambda item: (-(float(item.get("score") or 0.0)), int(item.get("chunk_index") or 0))
        )
        return merged_list

    def _keyword_match_score(self, source: Dict[str, Any], terms: List[str]) -> float:
        """根据关键词命中情况给来源打分（用于召回排序，不替代语义分数）。"""
        base_score = float(source.get("score") or 0.0)
        if not terms:
            return base_score

        title = str(source.get("title") or "").lower()
        content = str(source.get("content") or "").lower()
        description = str(source.get("description") or "").lower()
        text = f"{title}\n{description}\n{content}"

        matched_terms = [term for term in terms if term and term in text]
        if not matched_terms:
            return base_score

        score = 0.36 + 0.08 * min(3, len(matched_terms))
        if any(term in title for term in matched_terms):
            score += 0.1
        if source.get("source_type") == "repository":
            score += 0.04
        if len(terms) <= 2:
            score += 0.04

        return min(0.9, max(base_score, score))

    def _prefer_breadth_query(self, query: str) -> bool:
        """判断是否更偏向“广覆盖召回”策略。"""
        normalized = str(query or "").strip().lower()
        if not normalized:
            return False

        if any(
            keyword in normalized
            for keyword in (
                "有哪些",
                "有什么",
                "推荐",
                "项目",
                "仓库",
                "repo",
                "repository",
                "列表",
                "list",
                "合集",
            )
        ):
            return True

        terms = self._extract_query_terms(normalized)
        return len(normalized) <= 24 and 1 <= len(terms) <= 3

    def _prefer_repository_query(self, query: str) -> bool:
        """判断查询是否明显偏向仓库/项目发现。"""
        normalized = str(query or "").strip().lower()
        if not normalized:
            return False

        return any(
            keyword in normalized
            for keyword in (
                "开源项目",
                "项目",
                "仓库",
                "repo",
                "repository",
                "github",
            )
        )

    @classmethod
    def _extract_query_terms(cls, query: str) -> List[str]:
        """提取查询中的关键词（兼容中英文）。"""
        normalized = str(query or "").strip().lower()
        if not normalized:
            return []

        terms: List[str] = []
        for raw in cls.QUERY_TERM_PATTERN.findall(normalized):
            term = raw.strip("._-")
            if len(term) < 2:
                continue
            if term in cls.QUERY_STOP_TERMS:
                continue
            if term in terms:
                continue

            terms.append(term)
            if len(terms) >= 6:
                break

        return terms

    @staticmethod
    def _escape_ilike_term(term: str) -> str:
        return str(term or "").replace("%", "\\%").replace("_", "\\_").strip()


def run_async_in_thread(coro):
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
