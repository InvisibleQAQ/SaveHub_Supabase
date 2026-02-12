"""Agentic-RAG 服务主入口。"""

import logging
from typing import Any, AsyncGenerator, Dict, List, Optional

from supabase import Client

from app.services.agentic_rag.graph import build_agentic_rag_graph
from app.services.agentic_rag.prompts import AGGREGATION_SYSTEM_PROMPT, NO_KB_ANSWER
from app.services.agentic_rag.state import AgenticRagState, create_initial_state
from app.services.agentic_rag.tools import AgenticRagTools
from app.services.ai import ChatClient, EmbeddingClient

logger = logging.getLogger(__name__)

SSE_V2_EVENTS = {
    "progress",
    "rewrite",
    "clarification_required",
    "tool_call",
    "tool_result",
    "aggregation",
    "content",
    "done",
    "error",
}

STAGE_LOG_EVENTS = {
    "progress",
    "rewrite",
    "tool_call",
    "tool_result",
    "aggregation",
    "done",
}

NO_KB_FALLBACK_KEYWORDS = (
    "知识库暂无相关信息",
    "暂无相关信息",
    "没有相关信息",
    "未找到相关信息",
    "未检索到相关信息",
    "无法从知识库",
)


class AgenticRagService:
    """Agentic-RAG 服务。"""

    def __init__(
        self,
        chat_config: Dict[str, str],
        embedding_config: Dict[str, str],
        supabase: Client,
        user_id: str,
        agentic_rag_settings: Optional[Dict[str, Any]] = None,
    ):
        self.chat_config = chat_config
        self.embedding_config = embedding_config
        self.supabase = supabase
        self.user_id = user_id
        self.agentic_rag_settings = agentic_rag_settings or {}

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
            source_content_max_chars=int(
                self.agentic_rag_settings.get("agentic_rag_source_content_max_chars", 700)
            ),
        )
        self.graph = build_agentic_rag_graph(self.tools, self.chat_client)

    @staticmethod
    def _normalize_answer_text(text: str) -> str:
        normalized = str(text or "").strip().lower()
        for char in (" ", "\n", "\t", "\r", "。", "！", "？", "，", "、", "；", "：", ",", ".", "!", "?", ";", ":"):
            normalized = normalized.replace(char, "")
        return normalized

    @staticmethod
    def _is_no_kb_like(answer: str, no_kb_answer: str) -> bool:
        text = str(answer or "").strip()
        if not text:
            return True

        normalized = AgenticRagService._normalize_answer_text(text)
        explicit_candidates = {
            AgenticRagService._normalize_answer_text(no_kb_answer),
            AgenticRagService._normalize_answer_text(NO_KB_ANSWER),
            AgenticRagService._normalize_answer_text("知识库暂无相关信息"),
        }
        if normalized in explicit_candidates:
            return True

        if "[ref:" in text:
            return False

        return any(keyword in text for keyword in NO_KB_FALLBACK_KEYWORDS)

    @staticmethod
    def _build_recall_summary_from_sources(sources: List[Dict[str, Any]], max_items: int = 8) -> str:
        if not sources:
            return ""

        ordered = sorted(
            sources,
            key=lambda item: (-(float(item.get("score") or 0.0)), int(item.get("index") or 0)),
        )

        lines: List[str] = []
        used_keys: set[str] = set()
        for src in ordered:
            ref = src.get("index")
            if ref is None or not str(ref).isdigit():
                continue

            source_key = str(
                src.get("source_key")
                or src.get("id")
                or f"{src.get('article_id') or ''}:{src.get('repository_id') or ''}:{src.get('chunk_index') or 0}"
            ).strip()
            if source_key and source_key in used_keys:
                continue

            title = str(src.get("title") or "未命名来源").strip()
            snippet = str(src.get("content") or "").strip().replace("\n", " ")[:220]
            if snippet:
                lines.append(f"- {title}：{snippet}[ref:{int(ref)}]")
            else:
                lines.append(f"- {title}[ref:{int(ref)}]")

            if source_key:
                used_keys.add(source_key)
            if len(lines) >= max(1, int(max_items)):
                break

        if not lines:
            return ""

        return "检索到以下候选线索（召回优先，可能含噪声）：\n" + "\n".join(lines)

    @staticmethod
    def _build_tool_call_message(data: Dict[str, Any]) -> str:
        """生成工具调用阶段的自然语言描述。"""
        question_index = int(data.get("question_index", 0)) + 1
        tool_name = str(data.get("tool_name") or "")
        args = data.get("args") or {}

        if tool_name == "expand_context":
            top_k = int(args.get("top_k", 0) or 0)
            if top_k > 0:
                return f"第 {question_index} 个子问题初检结果不足，正在二次检索并扩展上下文（目标 {top_k} 条）"
            return f"第 {question_index} 个子问题初检结果不足，正在二次检索并扩展上下文"

        query = str(args.get("query") or "").strip()
        query_display = (query[:28] + "…") if len(query) > 28 else query
        if query_display:
            return f"正在检索第 {question_index} 个子问题：{query_display}"
        return f"正在检索第 {question_index} 个子问题"

    @staticmethod
    def _build_tool_result_message(data: Dict[str, Any]) -> str:
        """生成工具结果阶段的自然语言描述。"""
        question_index = int(data.get("question_index", 0)) + 1
        tool_name = str(data.get("tool_name") or "")
        result_count = int(data.get("result_count", 0) or 0)

        tool_display_name = "二次检索" if tool_name == "expand_context" else "初次检索"
        if result_count > 0:
            return f"第 {question_index} 个子问题{tool_display_name}完成，命中 {result_count} 条证据"
        return f"第 {question_index} 个子问题{tool_display_name}完成，未命中有效证据"

    @staticmethod
    def _extract_state_from_stream_chunk(chunk: Any) -> AgenticRagState | None:
        """从 LangGraph stream 返回值中提取状态字典。"""
        if isinstance(chunk, dict):
            if "events" in chunk:
                return chunk

            for value in chunk.values():
                if isinstance(value, dict) and "events" in value:
                    return value

        return None

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
                    "display_text": AgenticRagService._build_tool_result_message(data),
                },
            }

        if event_name == "progress":
            stage = str(data.get("stage") or "")
            message = str(data.get("message") or "").strip() or "正在处理你的问题"
            return {
                "event": "progress",
                "data": {
                    "stage": stage,
                    "message": message,
                    "display_text": message,
                },
            }

        if event_name == "tool_call":
            return {
                "event": "tool_call",
                "data": {
                    "question_index": data.get("question_index", 0),
                    "tool_name": data.get("tool_name", ""),
                    "args": data.get("args", {}),
                    "display_text": AgenticRagService._build_tool_call_message(data),
                },
            }

        if event_name == "rewrite":
            rewritten_queries = data.get("rewritten_queries") or []
            count = data.get("count", len(rewritten_queries))
            return {
                "event": "rewrite",
                "data": {
                    "original_query": data.get("original_query", ""),
                    "rewritten_queries": rewritten_queries,
                    "count": count,
                    "display_text": (
                        f"已完成问题重写，并拆分为 {count} 个子问题"
                        if int(count or 0) > 0
                        else "问题意图不够明确，准备请求补充信息"
                    ),
                },
            }

        if event_name == "aggregation":
            total_questions = int(data.get("total_questions", 0) or 0)
            completed = int(data.get("completed", 0) or 0)
            return {
                "event": "aggregation",
                "data": {
                    "total_questions": total_questions,
                    "completed": completed,
                    "display_text": f"已完成 {completed}/{total_questions} 个子问题，正在聚合答案",
                },
            }

        if event_name == "clarification_required":
            message = data.get("message", "请补充更多问题细节。")
            return {
                "event": "clarification_required",
                "data": {
                    "message": message,
                    "display_text": "需要补充问题细节后才能继续检索",
                },
            }

        if event_name == "content":
            return {
                "event": "content",
                "data": {
                    "delta": data.get("delta", ""),
                    "display_text": "证据准备完成，正在生成最终回答",
                },
            }

        if event_name == "done":
            message = data.get("message", "completed")
            return {
                "event": "done",
                "data": {
                    "message": message,
                    "sources": data.get("sources", []),
                    "display_text": (
                        "已暂停，等待你补充信息" if message == "clarification_required" else "回答已完成"
                    ),
                },
            }

        return {
            "event": "error",
            "data": {
                "message": data.get("message", "unknown error"),
            },
        }

    @staticmethod
    def _log_stage_event(event: Dict[str, Any]) -> None:
        """记录关键阶段事件日志，便于验收与排障。"""
        event_name = event.get("event")
        if event_name not in STAGE_LOG_EVENTS:
            return

        data = event.get("data") or {}
        logger.info(
            "agentic_rag_event event=%s question_index=%s tool_name=%s result_count=%s message=%s",
            event_name,
            data.get("question_index"),
            data.get("tool_name"),
            data.get("result_count"),
            data.get("message"),
        )

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        top_k: int = 10,
        min_score: float = 0.35,
        max_split_questions: int = 3,
        max_tool_rounds_per_question: int = 3,
        max_expand_calls_per_question: int = 2,
        retry_tool_on_failure: bool = True,
        max_tool_retry: int = 1,
        answer_max_tokens: int = 900,
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
            answer_max_tokens=answer_max_tokens,
            stream_output=True,
            agentic_rag_settings=self.agentic_rag_settings,
        )

        try:
            start_progress_event = self._normalize_v2_event(
                {
                    "event": "progress",
                    "data": {
                        "stage": "rewrite",
                        "message": "收到问题，正在分析意图并重写拆分",
                    },
                }
            )
            if start_progress_event:
                self._log_stage_event(start_progress_event)
                yield start_progress_event

            final_state: AgenticRagState = state
            emitted_event_count = 0

            try:
                stream_iter = self.graph.stream(state, stream_mode="values")
            except TypeError:
                stream_iter = self.graph.stream(state)

            for chunk in stream_iter:
                streamed_state = self._extract_state_from_stream_chunk(chunk)
                if streamed_state is None:
                    continue

                final_state = streamed_state
                events = final_state.get("events", [])

                while emitted_event_count < len(events):
                    event = events[emitted_event_count]
                    emitted_event_count += 1

                    normalized = self._normalize_v2_event(event)
                    if normalized:
                        self._log_stage_event(normalized)
                        yield normalized

            if final_state.get("clarification_required"):
                done_event = self._normalize_v2_event(
                    {
                        "event": "done",
                        "data": {
                            "message": "clarification_required",
                            "sources": final_state.get("all_sources", []),
                        },
                    }
                )
                if done_event:
                    self._log_stage_event(done_event)
                    yield done_event
                return

            final_answer_prompt = str(final_state.get("final_answer_prompt") or "").strip()
            fallback_final_answer = (
                str(final_state.get("final_answer") or "").strip()
                or str(final_state.get("no_kb_answer") or "").strip()
                or NO_KB_ANSWER
            )
            aggregation_system_prompt = str(
                final_state.get("aggregation_system_prompt")
                or self.agentic_rag_settings.get("agentic_rag_aggregation_system_prompt")
                or AGGREGATION_SYSTEM_PROMPT
            )
            aggregation_temperature = float(
                final_state.get("aggregation_temperature")
                or self.agentic_rag_settings.get("agentic_rag_aggregation_temperature", 0.2)
            )

            if final_answer_prompt:
                streamed_chunks: List[str] = []
                try:
                    async for chunk in self.chat_client.stream(
                        messages=[
                            {"role": "system", "content": aggregation_system_prompt},
                            {"role": "user", "content": final_answer_prompt},
                        ],
                        temperature=aggregation_temperature,
                        max_tokens=max(500, int(answer_max_tokens) + 400),
                    ):
                        if not chunk:
                            continue

                        streamed_chunks.append(chunk)
                        content_event = self._normalize_v2_event(
                            {"event": "content", "data": {"delta": chunk}}
                        )
                        if content_event:
                            yield content_event
                except Exception as exc:  # pragma: no cover
                    logger.warning("final answer stream failed, fallback to cached answer: %s", exc)

                streamed_answer = "".join(streamed_chunks).strip()
                if streamed_answer:
                    if AgenticRagService._is_no_kb_like(streamed_answer, str(final_state.get("no_kb_answer") or NO_KB_ANSWER)):
                        recall_summary = AgenticRagService._build_recall_summary_from_sources(
                            final_state.get("all_sources", []),
                            max_items=8,
                        )
                        if recall_summary:
                            patch_delta = f"\n\n{recall_summary}"
                            content_event = self._normalize_v2_event(
                                {"event": "content", "data": {"delta": patch_delta}}
                            )
                            if content_event:
                                yield content_event
                            streamed_answer = f"{streamed_answer}{patch_delta}".strip()
                    final_state["final_answer"] = streamed_answer
                else:
                    fallback_to_emit = fallback_final_answer
                    if AgenticRagService._is_no_kb_like(
                        fallback_to_emit,
                        str(final_state.get("no_kb_answer") or NO_KB_ANSWER),
                    ):
                        recall_summary = AgenticRagService._build_recall_summary_from_sources(
                            final_state.get("all_sources", []),
                            max_items=8,
                        )
                        if recall_summary:
                            fallback_to_emit = recall_summary

                    content_event = self._normalize_v2_event(
                        {"event": "content", "data": {"delta": fallback_to_emit}}
                    )
                    if content_event:
                        yield content_event
            else:
                fallback_to_emit = fallback_final_answer
                if AgenticRagService._is_no_kb_like(
                    fallback_to_emit,
                    str(final_state.get("no_kb_answer") or NO_KB_ANSWER),
                ):
                    recall_summary = AgenticRagService._build_recall_summary_from_sources(
                        final_state.get("all_sources", []),
                        max_items=8,
                    )
                    if recall_summary:
                        fallback_to_emit = recall_summary

                content_event = self._normalize_v2_event(
                    {"event": "content", "data": {"delta": fallback_to_emit}}
                )
                if content_event:
                    yield content_event

            done_event = self._normalize_v2_event(
                {
                    "event": "done",
                    "data": {
                        "message": "completed",
                        "sources": final_state.get("all_sources", []),
                    },
                }
            )
            if done_event:
                self._log_stage_event(done_event)
                yield done_event
        except Exception as exc:
            logger.error("AgenticRagService stream_chat failed: %s", exc)
            yield {
                "event": "error",
                "data": {
                    "message": str(exc),
                },
            }
