"""
Self-RAG 服务层。

实现 Self-RAG 的核心逻辑：检索决策、文档检索、相关性评估、响应生成、质量评估。
"""

import json
import logging
from typing import AsyncGenerator, List, Dict, Any, Optional, Tuple

from supabase import Client

from app.services.ai import ChatClient, EmbeddingClient
from app.services.rag.retriever import search_embeddings
from app.schemas.rag_chat import RetrievedSource

logger = logging.getLogger(__name__)


class SelfRagService:
    """Self-RAG 服务"""

    def __init__(
        self,
        chat_config: Dict[str, str],
        embedding_config: Dict[str, str],
        supabase: Client,
        user_id: str,
    ):
        """
        初始化 Self-RAG 服务。

        Args:
            chat_config: Chat API 配置 {api_key, api_base, model}
            embedding_config: Embedding API 配置 {api_key, api_base, model}
            supabase: Supabase 客户端
            user_id: 用户 ID
        """
        self.chat_config = chat_config
        self.embedding_config = embedding_config
        self.supabase = supabase
        self.user_id = user_id

        # 初始化 AI 客户端
        self.chat_client = ChatClient(
            api_key=chat_config["api_key"],
            api_base=chat_config["api_base"],
            model=chat_config["model"],
        )
        self.embedding_client = EmbeddingClient(
            api_key=embedding_config["api_key"],
            api_base=embedding_config["api_base"],
            model=embedding_config["model"],
        )

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        top_k: int = 10,
        min_score: float = 0.3,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Self-RAG 流式问答。

        Yields:
            SSE 事件字典 {event: str, data: dict}
        """
        user_query = messages[-1]["content"]

        # Step 1: 检索决策
        needs_retrieval, reason = await self._retrieval_decision(user_query)
        yield {"event": "decision", "data": {
            "needs_retrieval": needs_retrieval,
            "reason": reason
        }}

        context = ""
        sources: List[RetrievedSource] = []

        if needs_retrieval:
            # Step 2-3: 检索 + 相关性评估
            sources, context = await self._retrieve_and_filter(
                user_query, top_k, min_score
            )
            yield {"event": "retrieval", "data": {
                "total": len(sources),
                "sources": [s.model_dump() for s in sources[:5]]
            }}

        # Step 4: 流式生成响应
        full_response = ""
        async for chunk in self._generate_response_stream(
            messages, context, needs_retrieval
        ):
            full_response += chunk
            yield {"event": "content", "data": {"delta": chunk}}

        # Step 5-6: 质量评估
        if needs_retrieval and sources:
            supported, utility = await self._assess_quality(
                user_query, full_response, context
            )
        else:
            supported, utility = True, 0.8

        yield {"event": "assessment", "data": {
            "supported": supported,
            "utility": utility
        }}

        yield {"event": "done", "data": {"message": "completed"}}

    async def _retrieval_decision(self, query: str) -> Tuple[bool, str]:
        """
        判断是否需要检索。

        简单问候、闲聊、通用知识问题不需要检索。
        """
        prompt = """判断以下用户问题是否需要从知识库检索信息来回答。

规则：
- 问候语（你好、谢谢等）→ 不需要检索
- 闲聊（天气、心情等）→ 不需要检索
- 通用知识（什么是Python等）→ 不需要检索
- 涉及具体文章/仓库/技术细节 → 需要检索

用户问题：{query}

只返回 JSON：{{"needs_retrieval": true/false, "reason": "简短原因"}}"""

        try:
            content = await self.chat_client.complete(
                messages=[{"role": "user", "content": prompt.format(query=query)}],
                temperature=0,
                max_tokens=100,
            )

            # 清理可能的 markdown 代码块
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[-1]
            if content.endswith("```"):
                content = content.rsplit("```", 1)[0]
            content = content.strip()

            result = json.loads(content)
            return result.get("needs_retrieval", True), result.get("reason", "")
        except Exception as e:
            logger.warning(f"Retrieval decision failed: {e}, defaulting to True")
            return True, "默认检索"

    async def _retrieve_and_filter(
        self, query: str, top_k: int, min_score: float
    ) -> Tuple[List[RetrievedSource], str]:
        """检索并过滤相关文档。"""
        # 生成查询向量（异步）
        query_embedding = await self.embedding_client.embed(query)

        # 向量搜索
        hits = search_embeddings(
            self.supabase,
            query_embedding,
            self.user_id,
            top_k=top_k,
            min_score=min_score,
        )

        # 转换为 Source 对象并构建上下文
        sources = []
        context_parts = []

        for i, hit in enumerate(hits, 1):
            # 判断来源类型
            if hit.get("article_id"):
                source_type = "article"
                title = hit.get("article_title") or "未知文章"
                url = hit.get("article_url")
                # Article 不需要 repository 专用字段
                source = RetrievedSource(
                    id=str(hit["id"]),
                    index=i,
                    content=hit.get("content", "")[:500],
                    score=hit.get("score", 0),
                    source_type=source_type,
                    title=title,
                    url=url,
                )
            else:
                source_type = "repository"
                title = hit.get("repository_name") or "未知仓库"
                url = hit.get("repository_url")
                # Repository 包含额外字段用于引用卡片显示
                source = RetrievedSource(
                    id=str(hit["id"]),
                    index=i,
                    content=hit.get("content", "")[:500],
                    score=hit.get("score", 0),
                    source_type=source_type,
                    title=title,
                    url=url,
                    owner_login=hit.get("repository_owner_login"),
                    owner_avatar_url=hit.get("repository_owner_avatar_url"),
                    stargazers_count=hit.get("repository_stargazers_count"),
                    language=hit.get("repository_language"),
                    description=hit.get("repository_description"),
                )
            sources.append(source)

            context_parts.append(
                f"[来源 {i}] ({source_type}, 相关度: {source.score:.2f})\n"
                f"标题: {title}\n"
                f"内容: {hit.get('content', '')[:800]}\n"
            )

        context = "\n---\n".join(context_parts)
        return sources, context

    async def _generate_response_stream(
        self,
        messages: List[Dict[str, str]],
        context: str,
        needs_retrieval: bool,
    ) -> AsyncGenerator[str, None]:
        """流式生成响应。"""
        if needs_retrieval and context:
            system_prompt = f"""你是一个基于用户知识库的智能助手。请根据提供的上下文回答问题。

要求：
1. 优先使用上下文中的信息回答问题
2. 当引用来源信息时，必须在相关内容后插入引用标记 [ref:N]，N 是来源编号
3. 引用标记规则：
   - 使用 [ref:1]、[ref:2] 等格式
   - 可以在一处引用多个来源，如 [ref:1][ref:2]
   - 只引用你实际使用的来源，不要引用未使用的
   - 引用标记紧跟在相关陈述之后
4. 如果上下文信息不足，可以结合通用知识补充，但不要为通用知识添加引用
5. 回答要准确、有条理

示例：
- "根据资料，React 18 引入了并发渲染特性[ref:1]，这使得..."
- "该项目支持 macOS 和 Windows 平台[ref:2][ref:3]"

上下文：
{context}"""
        else:
            system_prompt = "你是一个友好的助手，请自然地回答用户问题。"

        chat_messages = [
            {"role": "system", "content": system_prompt},
            *messages
        ]

        async for chunk in self.chat_client.stream(
            messages=chat_messages,
            max_tokens=2048,
        ):
            yield chunk

    async def _assess_quality(
        self, query: str, response: str, context: str
    ) -> Tuple[bool, float]:
        """评估响应质量。"""
        prompt = f"""评估以下回答的质量。

问题：{query}
上下文：{context[:2000]}
回答：{response[:1000]}

评估：
1. supported: 回答是否被上下文支持（true/false）
2. utility: 回答的实用性（0-1分）

只返回 JSON：{{"supported": true, "utility": 0.8}}"""

        try:
            content = await self.chat_client.complete(
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=50,
            )
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[-1]
            if content.endswith("```"):
                content = content.rsplit("```", 1)[0]
            data = json.loads(content.strip())
            return data.get("supported", True), data.get("utility", 0.7)
        except Exception as e:
            logger.warning(f"Quality assessment failed: {e}")
            return True, 0.7
