"""Agentic-RAG 服务主入口。"""

import logging
from typing import Any, AsyncGenerator, Dict, List

from supabase import Client

from app.services.agentic_rag.graph import build_agentic_rag_graph
from app.services.agentic_rag.state import AgenticRagState, create_initial_state
from app.services.agentic_rag.tools import AgenticRagTools
from app.services.ai import ChatClient, EmbeddingClient

logger = logging.getLogger(__name__)

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


class AgenticRagService:
    """Agentic-RAG 服务（Phase 1 基础骨架）。"""

    def __init__(
        self,
        chat_config: Dict[str, str],
        embedding_config: Dict[str, str],
        supabase: Client,
        user_id: str,
    ):
        self.chat_config = chat_config
        self.embedding_config = embedding_config
        self.supabase = supabase
        self.user_id = user_id

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

        self.tools = AgenticRagTools(
            supabase=supabase,
            user_id=user_id,
            embedding_client=self.embedding_client,
        )
        self.graph = build_agentic_rag_graph(self.tools)

    @staticmethod
    def _normalize_v2_event(event: Dict[str, Any]) -> Dict[str, Any] | None:
        """过滤并规范 SSE v2 事件。"""
        event_name = str(event.get("event") or "").strip()
        data = event.get("data") or {}

        if event_name not in SSE_V2_EVENTS:
            return None

        if event_name == "tool_result":
            return {
                "event": "tool_result",
                "data": {
                    "question_index": data.get("question_index", 0),
                    "tool_name": data.get("tool_name", ""),
                    "result_count": data.get("result_count", 0),
                    "sources": data.get("sources", []),
                },
            }

        if event_name == "tool_call":
            return {
                "event": "tool_call",
                "data": {
                    "question_index": data.get("question_index", 0),
                    "tool_name": data.get("tool_name", ""),
                    "args": data.get("args", {}),
                },
            }

        if event_name == "rewrite":
            rewritten_queries = data.get("rewritten_queries") or []
            return {
                "event": "rewrite",
                "data": {
                    "original_query": data.get("original_query", ""),
                    "rewritten_queries": rewritten_queries,
                    "count": data.get("count", len(rewritten_queries)),
                },
            }

        if event_name == "aggregation":
            return {
                "event": "aggregation",
                "data": {
                    "total_questions": data.get("total_questions", 0),
                    "completed": data.get("completed", 0),
                },
            }

        if event_name == "clarification_required":
            return {
                "event": "clarification_required",
                "data": {
                    "message": data.get("message", "请补充更多问题细节。"),
                },
            }

        if event_name == "content":
            return {
                "event": "content",
                "data": {
                    "delta": data.get("delta", ""),
                },
            }

        if event_name == "done":
            return {
                "event": "done",
                "data": {
                    "message": data.get("message", "completed"),
                    "sources": data.get("sources", []),
                },
            }

        return {
            "event": "error",
            "data": {
                "message": data.get("message", "unknown error"),
            },
        }

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        top_k: int = 8,
        min_score: float = 0.35,
        max_split_questions: int = 3,
        max_tool_rounds_per_question: int = 3,
        max_expand_calls_per_question: int = 2,
        retry_tool_on_failure: bool = True,
        max_tool_retry: int = 1,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """运行 LangGraph 并输出阶段事件。"""
        state: AgenticRagState = create_initial_state(
            messages=messages,
            top_k=top_k,
            min_score=min_score,
            max_split_questions=max_split_questions,
            max_tool_rounds_per_question=max_tool_rounds_per_question,
            max_expand_calls_per_question=max_expand_calls_per_question,
            retry_tool_on_failure=retry_tool_on_failure,
            max_tool_retry=max_tool_retry,
        )

        try:
            final_state = self.graph.invoke(state)

            for event in final_state.get("events", []):
                normalized = self._normalize_v2_event(event)
                if normalized:
                    yield normalized

            if final_state.get("clarification_required"):
                yield self._normalize_v2_event(
                    {
                    "event": "done",
                    "data": {
                        "message": "clarification_required",
                        "sources": final_state.get("all_sources", []),
                    },
                    }
                )
                return

            final_answer = final_state.get("final_answer", "")
            if final_answer:
                yield self._normalize_v2_event(
                    {"event": "content", "data": {"delta": final_answer}}
                )

            yield self._normalize_v2_event(
                {
                "event": "done",
                "data": {
                    "message": "completed",
                    "sources": final_state.get("all_sources", []),
                },
                }
            )
        except Exception as e:
            logger.error(f"AgenticRagService stream_chat failed: {e}")
            yield {
                "event": "error",
                "data": {
                    "message": str(e),
                },
            }
