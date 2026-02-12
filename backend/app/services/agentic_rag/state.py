"""Agentic-RAG 图状态定义与辅助函数。"""

from hashlib import md5
from typing import Any, Dict, List, Optional, TypedDict

from app.services.agentic_rag.prompts import (
    AGGREGATION_SYSTEM_PROMPT,
    ANSWER_GENERATION_SYSTEM_PROMPT,
    CLARIFICATION_PROMPT,
    NO_KB_ANSWER,
    QUERY_ANALYSIS_SYSTEM_PROMPT,
)


class AgenticRagState(TypedDict, total=False):
    """LangGraph 运行时状态。"""

    messages: List[Dict[str, str]]
    top_k: int
    min_score: float
    max_split_questions: int
    max_tool_rounds_per_question: int
    max_expand_calls_per_question: int
    retry_tool_on_failure: bool
    max_tool_retry: int
    answer_max_tokens: int
    stream_output: bool

    history_summary_temperature: float
    history_summary_max_tokens: int
    query_analysis_temperature: float
    query_analysis_max_tokens: int
    answer_generation_temperature: float
    aggregation_temperature: float

    expand_context_window_size: int
    expand_context_top_k_min: int
    expand_context_min_score_delta: float
    retry_search_min_score_delta: float
    seed_source_limit: int

    finalize_min_sources: int
    finalize_min_high_confidence: int
    evidence_max_sources: int
    evidence_snippet_max_chars: int

    query_analysis_system_prompt: str
    clarification_prompt: str
    answer_generation_system_prompt: str
    aggregation_system_prompt: str
    no_kb_answer: str
    history_summary_system_prompt: str
    history_summary_user_prompt_template: str

    conversation_summary: str
    last_user_query: str

    original_query: str
    rewritten_queries: List[str]
    pending_questions: List[str]
    current_question: Optional[str]
    current_question_index: int

    clarification_required: bool
    clarification_message: Optional[str]
    analysis_reason: str

    current_tool_round: int
    current_expand_calls: int
    current_tool_name: Optional[str]
    current_tool_args: Dict[str, Any]
    current_tool_retry: int
    current_seed_source_ids: List[str]
    current_sources: List[Dict[str, Any]]
    enough_for_finalize: bool

    question_answers: List[Dict[str, Any]]
    source_index_map: Dict[str, int]
    all_sources: List[Dict[str, Any]]
    final_answer: str
    final_answer_prompt: str

    events: List[Dict[str, Any]]
    error: Optional[str]


def create_initial_state(
    messages: List[Dict[str, str]],
    top_k: int,
    min_score: float,
    max_split_questions: int,
    max_tool_rounds_per_question: int,
    max_expand_calls_per_question: int,
    retry_tool_on_failure: bool,
    max_tool_retry: int,
    answer_max_tokens: int,
    stream_output: bool = True,
    agentic_rag_settings: Optional[Dict[str, Any]] = None,
) -> AgenticRagState:
    """创建图初始状态。"""
    rag_settings = agentic_rag_settings or {}

    return {
        "messages": messages,
        "top_k": top_k,
        "min_score": min_score,
        "max_split_questions": max_split_questions,
        "max_tool_rounds_per_question": max_tool_rounds_per_question,
        "max_expand_calls_per_question": max_expand_calls_per_question,
        "retry_tool_on_failure": retry_tool_on_failure,
        "max_tool_retry": max_tool_retry,
        "answer_max_tokens": answer_max_tokens,
        "stream_output": stream_output,
        "history_summary_temperature": float(
            rag_settings.get("agentic_rag_history_summary_temperature", 0.1)
        ),
        "history_summary_max_tokens": int(
            rag_settings.get("agentic_rag_history_summary_max_tokens", 160)
        ),
        "query_analysis_temperature": float(
            rag_settings.get("agentic_rag_query_analysis_temperature", 0.1)
        ),
        "query_analysis_max_tokens": int(
            rag_settings.get("agentic_rag_query_analysis_max_tokens", 320)
        ),
        "answer_generation_temperature": float(
            rag_settings.get("agentic_rag_answer_generation_temperature", 0.2)
        ),
        "aggregation_temperature": float(
            rag_settings.get("agentic_rag_aggregation_temperature", 0.2)
        ),
        "expand_context_window_size": int(
            rag_settings.get("agentic_rag_expand_context_window_size", 2)
        ),
        "expand_context_top_k_min": int(
            rag_settings.get("agentic_rag_expand_context_top_k_min", 4)
        ),
        "expand_context_min_score_delta": float(
            rag_settings.get("agentic_rag_expand_context_min_score_delta", -0.1)
        ),
        "retry_search_min_score_delta": float(
            rag_settings.get("agentic_rag_retry_search_min_score_delta", -0.15)
        ),
        "seed_source_limit": int(rag_settings.get("agentic_rag_seed_source_limit", 8)),
        "finalize_min_sources": int(rag_settings.get("agentic_rag_finalize_min_sources", 5)),
        "finalize_min_high_confidence": int(
            rag_settings.get("agentic_rag_finalize_min_high_confidence", 1)
        ),
        "evidence_max_sources": int(rag_settings.get("agentic_rag_evidence_max_sources", 12)),
        "evidence_snippet_max_chars": int(
            rag_settings.get("agentic_rag_evidence_snippet_max_chars", 380)
        ),
        "query_analysis_system_prompt": str(
            rag_settings.get("agentic_rag_query_analysis_system_prompt")
            or QUERY_ANALYSIS_SYSTEM_PROMPT
        ),
        "clarification_prompt": str(
            rag_settings.get("agentic_rag_clarification_prompt") or CLARIFICATION_PROMPT
        ),
        "answer_generation_system_prompt": str(
            rag_settings.get("agentic_rag_answer_generation_system_prompt")
            or ANSWER_GENERATION_SYSTEM_PROMPT
        ),
        "aggregation_system_prompt": str(
            rag_settings.get("agentic_rag_aggregation_system_prompt") or AGGREGATION_SYSTEM_PROMPT
        ),
        "no_kb_answer": str(rag_settings.get("agentic_rag_no_kb_answer") or NO_KB_ANSWER),
        "history_summary_system_prompt": str(
            rag_settings.get("agentic_rag_history_summary_system_prompt") or "你是精炼总结助手。"
        ),
        "history_summary_user_prompt_template": str(
            rag_settings.get("agentic_rag_history_summary_user_prompt_template")
            or "你是对话摘要助手。请把以下历史对话压缩为 1-2 句中文摘要，保留主题、关键实体和未解决问题。只输出摘要正文。"
        ),
        "conversation_summary": "",
        "last_user_query": "",
        "original_query": "",
        "rewritten_queries": [],
        "pending_questions": [],
        "current_question": None,
        "current_question_index": -1,
        "clarification_required": False,
        "clarification_message": None,
        "analysis_reason": "",
        "current_tool_round": 0,
        "current_expand_calls": 0,
        "current_tool_name": None,
        "current_tool_args": {},
        "current_tool_retry": 0,
        "current_seed_source_ids": [],
        "current_sources": [],
        "enough_for_finalize": False,
        "question_answers": [],
        "source_index_map": {},
        "all_sources": [],
        "final_answer": "",
        "final_answer_prompt": "",
        "events": [],
        "error": None,
    }


def append_event(state: AgenticRagState, event: str, data: Dict[str, Any]) -> None:
    """向状态中追加阶段事件。"""
    events = state.setdefault("events", [])
    events.append({"event": event, "data": data})


def register_sources_with_index(
    state: AgenticRagState,
    sources: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """为来源分配全局 index（从 1 开始），并返回带 index 的来源。"""
    source_index_map = state.setdefault("source_index_map", {})
    all_sources = state.setdefault("all_sources", [])

    normalized: List[Dict[str, Any]] = []
    for source in sources:
        source_key = build_source_key(source)
        if not source_key:
            continue

        if source_key not in source_index_map:
            next_index = len(source_index_map) + 1
            source_index_map[source_key] = next_index

            source_copy = dict(source)
            source_copy["index"] = next_index
            source_copy["source_key"] = source_key
            all_sources.append(source_copy)

        indexed_source = dict(source)
        indexed_source["index"] = source_index_map[source_key]
        indexed_source["source_key"] = source_key
        normalized.append(indexed_source)

    return normalized


def build_source_key(source: Dict[str, Any]) -> str:
    """构建全局去重 key，优先使用 source 类型 + 业务主键 + chunk。"""
    source_id = str(source.get("id") or "").strip()
    if source_id:
        return f"embedding:{source_id}"

    chunk_index = source.get("chunk_index")
    if chunk_index is None:
        chunk_index = 0

    content = str(source.get("content") or "").strip()
    content_digest = ""
    if content:
        content_digest = md5(content[:200].encode("utf-8")).hexdigest()[:16]

    article_id = source.get("article_id")
    if article_id:
        suffix = f":{content_digest}" if content_digest else ""
        return f"article:{article_id}:{chunk_index}{suffix}"

    repository_id = source.get("repository_id")
    if repository_id:
        suffix = f":{content_digest}" if content_digest else ""
        return f"repo:{repository_id}:{chunk_index}{suffix}"

    if content_digest:
        return f"content:{content_digest}"

    return ""
