"""Agentic-RAG 图状态定义与辅助函数。"""

from typing import Any, Dict, List, Optional, TypedDict


class AgenticRagState(TypedDict, total=False):
    """LangGraph 运行时状态。"""

    messages: List[Dict[str, str]]
    top_k: int
    min_score: float
    max_split_questions: int
    max_tool_rounds_per_question: int
    max_expand_calls_per_question: int

    original_query: str
    rewritten_queries: List[str]
    pending_questions: List[str]
    current_question: Optional[str]
    current_question_index: int

    clarification_required: bool
    clarification_message: Optional[str]

    current_tool_round: int
    current_expand_calls: int
    current_tool_name: Optional[str]
    current_tool_args: Dict[str, Any]
    current_sources: List[Dict[str, Any]]
    enough_for_finalize: bool

    question_answers: List[Dict[str, Any]]
    source_index_map: Dict[str, int]
    all_sources: List[Dict[str, Any]]
    final_answer: str

    events: List[Dict[str, Any]]
    error: Optional[str]


def create_initial_state(
    messages: List[Dict[str, str]],
    top_k: int,
    min_score: float,
    max_split_questions: int,
    max_tool_rounds_per_question: int,
    max_expand_calls_per_question: int,
) -> AgenticRagState:
    """创建图初始状态。"""
    return {
        "messages": messages,
        "top_k": top_k,
        "min_score": min_score,
        "max_split_questions": max_split_questions,
        "max_tool_rounds_per_question": max_tool_rounds_per_question,
        "max_expand_calls_per_question": max_expand_calls_per_question,
        "original_query": "",
        "rewritten_queries": [],
        "pending_questions": [],
        "current_question": None,
        "current_question_index": -1,
        "clarification_required": False,
        "clarification_message": None,
        "current_tool_round": 0,
        "current_expand_calls": 0,
        "current_tool_name": None,
        "current_tool_args": {},
        "current_sources": [],
        "enough_for_finalize": False,
        "question_answers": [],
        "source_index_map": {},
        "all_sources": [],
        "final_answer": "",
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
        source_id = str(source.get("id") or "")
        if not source_id:
            continue

        if source_id not in source_index_map:
            next_index = len(source_index_map) + 1
            source_index_map[source_id] = next_index

            source_copy = dict(source)
            source_copy["index"] = next_index
            all_sources.append(source_copy)

        indexed_source = dict(source)
        indexed_source["index"] = source_index_map[source_id]
        normalized.append(indexed_source)

    return normalized

