"""Agentic-RAG 图节点实现（Phase 1 骨架版）。"""

import logging
from typing import Any, Dict, List

from app.services.agentic_rag.prompts import CLARIFICATION_PROMPT
from app.services.agentic_rag.state import (
    AgenticRagState,
    append_event,
    register_sources_with_index,
)
from app.services.agentic_rag.tools import AgenticRagTools

logger = logging.getLogger(__name__)


def rewrite_and_split_node(state: AgenticRagState) -> AgenticRagState:
    """改写并拆分用户问题（Phase 1 先做规则拆分）。"""
    messages = state.get("messages", [])
    if not messages:
        state["error"] = "messages is empty"
        return state

    original_query = messages[-1].get("content", "").strip()
    state["original_query"] = original_query

    max_split = state.get("max_split_questions", 3)
    candidate_parts = [
        p.strip()
        for p in original_query.replace("？", "?").split("?")
        if p.strip()
    ]
    rewritten_queries = candidate_parts[:max_split] if candidate_parts else [original_query]

    state["rewritten_queries"] = rewritten_queries
    state["pending_questions"] = list(rewritten_queries)

    append_event(
        state,
        "rewrite",
        {
            "original_query": original_query,
            "rewritten_queries": rewritten_queries,
            "count": len(rewritten_queries),
        },
    )
    return state


def clarification_gate_node(state: AgenticRagState) -> AgenticRagState:
    """澄清判断节点。"""
    original_query = state.get("original_query", "")

    if len(original_query) < 2:
        state["clarification_required"] = True
        state["clarification_message"] = CLARIFICATION_PROMPT
        append_event(
            state,
            "clarification_required",
            {"message": state["clarification_message"]},
        )
    else:
        state["clarification_required"] = False
        state["clarification_message"] = None

    return state


def dispatch_questions_node(state: AgenticRagState) -> AgenticRagState:
    """调度下一个待处理子问题。"""
    pending = state.get("pending_questions", [])
    if not pending:
        state["current_question"] = None
        return state

    next_question = pending.pop(0)
    state["pending_questions"] = pending
    state["current_question"] = next_question
    state["current_question_index"] = state.get("current_question_index", -1) + 1
    state["current_tool_round"] = 0
    state["current_expand_calls"] = 0
    state["current_tool_retry"] = 0
    state["current_seed_source_ids"] = []
    state["current_sources"] = []
    state["enough_for_finalize"] = False

    return state


def agent_reason_node(state: AgenticRagState) -> AgenticRagState:
    """Agent 推理节点（Phase 1 使用规则触发工具）。"""
    current_question = (state.get("current_question") or "").strip()
    if not current_question:
        state["enough_for_finalize"] = True
        return state

    max_rounds = state.get("max_tool_rounds_per_question", 3)
    tool_round = state.get("current_tool_round", 0)

    if tool_round >= max_rounds:
        state["enough_for_finalize"] = True
        append_event(
            state,
            "tool_loop_guard",
            {
                "question_index": state.get("current_question_index", 0),
                "reason": "max_tool_rounds_reached",
                "current_tool_round": tool_round,
                "max_tool_rounds": max_rounds,
            },
        )
        return state

    current_seed_source_ids = state.get("current_seed_source_ids", [])

    if tool_round == 0:
        tool_name = "search_embeddings"
        tool_args = {
            "query": current_question,
            "top_k": state.get("top_k", 8),
            "min_score": state.get("min_score", 0.35),
        }
    else:
        tool_name = "expand_context"
        tool_args = {
            "seed_source_ids": current_seed_source_ids,
            "seed_query": current_question,
            "window_size": 2,
            "top_k": max(2, state.get("top_k", 8) // 2),
            "min_score": max(0.0, state.get("min_score", 0.35) - 0.05),
        }

    state["current_tool_name"] = tool_name
    state["current_tool_args"] = tool_args
    state["current_tool_retry"] = 0
    state["current_tool_round"] = tool_round + 1

    append_event(
        state,
        "tool_call",
        {
            "question_index": state.get("current_question_index", 0),
            "tool_name": tool_name,
            "args": tool_args,
        },
    )
    return state


def run_tools_node_factory(tools: AgenticRagTools):
    """构建执行工具节点。"""

    def run_tools_node(state: AgenticRagState) -> AgenticRagState:
        tool_name = state.get("current_tool_name")
        tool_args = state.get("current_tool_args", {})

        max_retry = max(0, int(state.get("max_tool_retry", 1)))
        should_retry = bool(state.get("retry_tool_on_failure", True))

        sources: List[Dict[str, Any]] = []
        tool_error: str | None = None
        retry_attempt = 0

        while True:
            try:
                if tool_name == "search_embeddings":
                    sources = tools.search_embeddings_tool(**tool_args)
                elif tool_name == "expand_context":
                    max_expand_calls = state.get("max_expand_calls_per_question", 2)
                    if state.get("current_expand_calls", 0) < max_expand_calls:
                        state["current_expand_calls"] = state.get("current_expand_calls", 0) + 1
                        sources = tools.expand_context_tool(**tool_args)
                    else:
                        sources = []
                else:
                    logger.warning(f"Unknown tool: {tool_name}")
                    sources = []
                break
            except Exception as e:  # pragma: no cover
                tool_error = str(e)
                if (not should_retry) or retry_attempt >= max_retry:
                    break

                retry_attempt += 1
                state["current_tool_retry"] = retry_attempt
                append_event(
                    state,
                    "tool_retry",
                    {
                        "question_index": state.get("current_question_index", 0),
                        "tool_name": tool_name,
                        "attempt": retry_attempt,
                        "max_retry": max_retry,
                        "error": tool_error,
                    },
                )

        state["current_tool_retry"] = retry_attempt

        indexed_sources = register_sources_with_index(state, sources)
        current_sources = state.get("current_sources", [])
        current_sources.extend(indexed_sources)
        state["current_sources"] = current_sources

        if indexed_sources:
            state["current_seed_source_ids"] = [src.get("id") for src in indexed_sources if src.get("id")]

        append_event(
            state,
            "tool_result",
            {
                "question_index": state.get("current_question_index", 0),
                "tool_name": tool_name,
                "retry": retry_attempt,
                "error": tool_error,
                "result_count": len(indexed_sources),
                "sources": indexed_sources[:5],
            },
        )
        return state

    return run_tools_node


def judge_enough_node(state: AgenticRagState) -> AgenticRagState:
    """判断当前子问题是否可收敛。"""
    current_sources = state.get("current_sources", [])
    current_tool_round = state.get("current_tool_round", 0)
    max_tool_rounds = state.get("max_tool_rounds_per_question", 3)

    max_expand_calls = state.get("max_expand_calls_per_question", 2)
    current_expand_calls = state.get("current_expand_calls", 0)

    state["enough_for_finalize"] = (
        len(current_sources) > 0
        or current_tool_round >= max_tool_rounds
        or current_expand_calls >= max_expand_calls
    )

    if state["enough_for_finalize"] and current_tool_round >= max_tool_rounds:
        append_event(
            state,
            "tool_loop_guard",
            {
                "question_index": state.get("current_question_index", 0),
                "reason": "judge_max_tool_rounds",
                "current_tool_round": current_tool_round,
                "max_tool_rounds": max_tool_rounds,
            },
        )
    return state


def finalize_answer_node(state: AgenticRagState) -> AgenticRagState:
    """生成子问题答案片段（骨架版：基于检索摘要）。"""
    question = state.get("current_question") or ""
    sources = state.get("current_sources", [])

    if sources:
        ref_indices = sorted({int(src.get("index", 0)) for src in sources if src.get("index")})
        ref_tags = "".join([f"[ref:{idx}]" for idx in ref_indices])
        answer = f"针对“{question}”，已在知识库中检索到相关信息{ref_tags}。"
    else:
        answer = f"针对“{question}”，知识库暂无相关信息。"

    question_answers = state.get("question_answers", [])
    question_answers.append(
        {
            "question": question,
            "answer": answer,
            "sources": sources,
        }
    )
    state["question_answers"] = question_answers

    state["current_question"] = None
    state["current_sources"] = []
    state["current_tool_name"] = None
    state["current_tool_args"] = {}
    state["current_tool_retry"] = 0
    state["current_seed_source_ids"] = []
    state["enough_for_finalize"] = False
    return state


def aggregate_answers_node(state: AgenticRagState) -> AgenticRagState:
    """聚合多子问题答案。"""
    question_answers = state.get("question_answers", [])

    append_event(
        state,
        "aggregation",
        {
            "total_questions": len(state.get("rewritten_queries", [])),
            "completed": len(question_answers),
        },
    )

    final_answer = "\n\n".join(item.get("answer", "") for item in question_answers).strip()
    state["final_answer"] = final_answer
    return state
