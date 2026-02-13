"""Agentic-RAG 图节点实现。"""

import json
import logging
import re
from typing import Any, Dict, List

from app.services.agentic_rag.prompts import CLARIFICATION_PROMPT, NO_KB_ANSWER
from app.services.agentic_rag.state import (
    AgenticRagState,
    append_event,
    register_sources_with_index,
)
from app.services.agentic_rag.tools import AgenticRagTools, run_async_in_thread
from app.services.ai import ChatClient

logger = logging.getLogger(__name__)

REF_PATTERN = re.compile(r"\[ref:(\d+)\]")
NO_KB_FALLBACK_KEYWORDS = (
    "知识库暂无相关信息",
    "暂无相关信息",
    "没有相关信息",
    "未找到相关信息",
    "未检索到相关信息",
    "无法从知识库",
)

MULTI_INTENT_HINTS = (
    "以及",
    "并且",
    "同时",
    "分别",
    "对比",
    "比较",
    "区别",
    "优缺点",
    "还是",
    "vs",
    "versus",
)

REWRITE_NOISE_PHRASES = (
    "请问",
    "我想",
    "想了解",
    "帮我",
    "帮忙",
    "可以",
    "能不能",
    "有没有",
    "有吗",
    "给我",
    "推荐",
    "介绍",
    "讲讲",
    "看看",
    "一下",
    "一下子",
)

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
    "有没有",
    "有吗",
    "哪些",
    "什么",
    "一下",
    "相关",
    "方面",
    "关于",
    "推荐",
    "介绍",
}

QUERY_TERM_PATTERN = re.compile(r"[a-z0-9][a-z0-9._/-]{1,}|[\u4e00-\u9fff]{2,}", re.IGNORECASE)
YEAR_PATTERN = re.compile(r"(?:19|20)\d{2}年?")
EXAMPLE_PARENS_PATTERN = re.compile(r"[（(](?:如|例如|比如|such as)[^）)]{0,100}[）)]", re.IGNORECASE)
SYNONYM_EXPANSION_LIMIT = 2
MAX_SPLIT_QUESTIONS_LIMIT = 10

QUERY_SYNONYM_GROUPS = (
    (
        "rag",
        "retrieval-augmented generation",
        "retrieval augmented generation",
        "检索增强生成",
    ),
)


def _append_llm_call_event(
    state: AgenticRagState,
    *,
    stage: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    response: str = "",
    error: str = "",
    question_index: int | None = None,
    question: str = "",
    skipped: bool = False,
    skip_reason: str = "",
) -> None:
    data: Dict[str, Any] = {
        "stage": stage,
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response": response,
        "error": error,
        "skipped": bool(skipped),
        "skip_reason": skip_reason,
    }
    if question:
        data["question"] = question
    if question_index is not None:
        data["question_index"] = question_index
    append_event(state, "llm_call", data)


def summarize_history_node_factory(chat_client: ChatClient):
    """构建会话摘要节点。"""

    def summarize_history_node(state: AgenticRagState) -> AgenticRagState:
        messages = state.get("messages", [])
        if not messages:
            state["error"] = "messages is empty"
            return state

        history_system_prompt = str(state.get("history_summary_system_prompt") or "你是精炼总结助手。")
        history_temperature = float(state.get("history_summary_temperature", 0.1))
        history_max_tokens = int(state.get("history_summary_max_tokens", 160))

        user_messages = [m for m in messages if m.get("role") == "user" and m.get("content")]
        last_user_query = str(user_messages[-1].get("content") if user_messages else "").strip()
        state["last_user_query"] = last_user_query

        if len(messages) < 4:
            state["conversation_summary"] = ""
            _append_llm_call_event(
                state,
                stage="history_summary",
                system_prompt=history_system_prompt,
                user_prompt="",
                temperature=history_temperature,
                max_tokens=history_max_tokens,
                skipped=True,
                skip_reason="insufficient_messages",
            )
            return state

        history_for_summary = messages[:-1][-6:]
        if not history_for_summary:
            state["conversation_summary"] = ""
            _append_llm_call_event(
                state,
                stage="history_summary",
                system_prompt=history_system_prompt,
                user_prompt="",
                temperature=history_temperature,
                max_tokens=history_max_tokens,
                skipped=True,
                skip_reason="no_history_for_summary",
            )
            return state

        lines: List[str] = []
        for msg in history_for_summary:
            role = "用户" if msg.get("role") == "user" else "助手"
            content = str(msg.get("content") or "").strip()
            if content:
                lines.append(f"{role}: {content}")

        if not lines:
            state["conversation_summary"] = ""
            _append_llm_call_event(
                state,
                stage="history_summary",
                system_prompt=history_system_prompt,
                user_prompt="",
                temperature=history_temperature,
                max_tokens=history_max_tokens,
                skipped=True,
                skip_reason="empty_history_lines",
            )
            return state

        history_text = "\n".join(lines)
        summary_template = (
            str(state.get("history_summary_user_prompt_template") or "").strip()
            or "你是对话摘要助手。请把以下历史对话压缩为 1-2 句中文摘要，保留主题、关键实体和未解决问题。只输出摘要正文。"
        )
        prompt = (
            f"{summary_template}\n\n"
            f"对话历史：\n{history_text}"
        )

        try:
            summary = run_async_in_thread(
                chat_client.complete(
                    messages=[
                        {
                            "role": "system",
                            "content": history_system_prompt,
                        },
                        {"role": "user", "content": prompt},
                    ],
                    temperature=history_temperature,
                    max_tokens=history_max_tokens,
                )
            )
            summary_text = str(summary or "").strip()
            state["conversation_summary"] = summary_text
            _append_llm_call_event(
                state,
                stage="history_summary",
                system_prompt=history_system_prompt,
                user_prompt=prompt,
                temperature=history_temperature,
                max_tokens=history_max_tokens,
                response=summary_text,
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("history summarization failed: %s", exc)
            state["conversation_summary"] = ""
            _append_llm_call_event(
                state,
                stage="history_summary",
                system_prompt=history_system_prompt,
                user_prompt=prompt,
                temperature=history_temperature,
                max_tokens=history_max_tokens,
                error=str(exc),
            )

        return state

    return summarize_history_node


def rewrite_and_split_node_factory(chat_client: ChatClient):
    """构建改写与拆分节点。"""

    def rewrite_and_split_node(state: AgenticRagState) -> AgenticRagState:
        messages = state.get("messages", [])
        if not messages:
            state["error"] = "messages is empty"
            return state

        original_query = (state.get("last_user_query") or messages[-1].get("content") or "").strip()
        summary = (state.get("conversation_summary") or "").strip()

        state["original_query"] = original_query
        state["analysis_reason"] = ""

        if not original_query:
            state["clarification_required"] = True
            state["clarification_message"] = str(
                state.get("clarification_prompt") or CLARIFICATION_PROMPT
            )
            append_event(
                state,
                "clarification_required",
                {"message": state["clarification_message"]},
            )
            return state

        max_split = _normalize_max_split_questions(state.get("max_split_questions", 3))
        analysis_system_prompt = str(state.get("query_analysis_system_prompt") or "")
        analysis_temperature = float(state.get("query_analysis_temperature", 0.1))
        analysis_max_tokens = int(state.get("query_analysis_max_tokens", 320))

        allow_split = _should_split_query(original_query)
        prefer_keyword_mode = _prefer_keyword_first_rewrite(original_query, summary)

        if prefer_keyword_mode:
            keyword_query = _build_keyword_focused_query(original_query)
            rewritten_queries = _expand_rewritten_queries_with_synonym_variants(
                queries=[keyword_query],
                max_split=max_split,
            )
            if not rewritten_queries:
                fallback_query = _compact_text(original_query) or original_query
                rewritten_queries = [fallback_query]
            state["rewritten_queries"] = rewritten_queries
            state["pending_questions"] = list(rewritten_queries)
            state["clarification_required"] = False
            state["clarification_message"] = None
            state["analysis_reason"] = "keyword_mode"

            _append_llm_call_event(
                state,
                stage="query_analysis",
                system_prompt=analysis_system_prompt,
                user_prompt=(
                    f"conversation_summary:\n{summary or '无'}\n\n"
                    f"current_query:\n{original_query}\n\n"
                    f"max_split_questions={max_split}"
                ),
                temperature=analysis_temperature,
                max_tokens=analysis_max_tokens,
                skipped=True,
                skip_reason="simple_query_keyword_mode",
                response=_json_dumps_compact(
                    {
                        "is_clear": True,
                        "questions": rewritten_queries,
                        "clarification_needed": "",
                        "reason": "keyword_mode",
                    }
                ),
            )

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

        analysis_payload = _analyze_query_with_llm(
            state=state,
            chat_client=chat_client,
            original_query=original_query,
            conversation_summary=summary,
            max_split=max_split,
            system_prompt=analysis_system_prompt,
            temperature=analysis_temperature,
            max_tokens=analysis_max_tokens,
        )

        questions = analysis_payload.get("questions") or []
        is_clear = bool(analysis_payload.get("is_clear")) and len(questions) > 0
        clarification_needed = str(analysis_payload.get("clarification_needed") or "").strip()
        reason = str(analysis_payload.get("reason") or "").strip()
        state["analysis_reason"] = reason[:20]

        if not is_clear:
            state["clarification_required"] = True
            state["clarification_message"] = (
                clarification_needed
                if len(clarification_needed) >= 6
                else str(state.get("clarification_prompt") or CLARIFICATION_PROMPT)
            )
            state["rewritten_queries"] = []
            state["pending_questions"] = []
            append_event(
                state,
                "rewrite",
                {
                    "original_query": original_query,
                    "rewritten_queries": [],
                    "count": 0,
                },
            )
            append_event(
                state,
                "clarification_required",
                {"message": state["clarification_message"]},
            )
            return state

        rewritten_queries = _sanitize_rewritten_queries(
            questions=questions,
            original_query=original_query,
            max_split=max_split,
            allow_split=allow_split,
        )
        if not rewritten_queries:
            rewritten_queries = _expand_rewritten_queries_with_synonym_variants(
                queries=[_build_keyword_focused_query(original_query)],
                max_split=max_split,
            )
        if not rewritten_queries:
            fallback_query = _compact_text(original_query) or original_query
            rewritten_queries = [fallback_query]

        state["rewritten_queries"] = rewritten_queries
        state["pending_questions"] = list(rewritten_queries)
        state["clarification_required"] = False
        state["clarification_message"] = None

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

    return rewrite_and_split_node


def clarification_gate_node(state: AgenticRagState) -> AgenticRagState:
    """澄清判断节点。"""
    if state.get("clarification_required"):
        return state

    original_query = state.get("original_query", "")
    if len(original_query.strip()) < 2:
        state["clarification_required"] = True
        state["clarification_message"] = str(state.get("clarification_prompt") or CLARIFICATION_PROMPT)
        append_event(
            state,
            "clarification_required",
            {"message": state["clarification_message"]},
        )
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
    state["current_parent_calls"] = 0
    state["current_tool_retry"] = 0
    state["current_seed_source_ids"] = []
    state["current_sources"] = []
    state["enough_for_finalize"] = False
    append_event(
        state,
        "progress",
        {
            "stage": "toolCall",
            "message": f"开始处理第 {state['current_question_index'] + 1} 个子问题，准备检索证据",
        },
    )
    return state


def agent_reason_node(state: AgenticRagState) -> AgenticRagState:
    """Agent 推理节点（检索策略决策）。"""
    current_question = (state.get("current_question") or "").strip()
    if not current_question:
        state["enough_for_finalize"] = True
        return state

    max_rounds = max(1, int(state.get("max_tool_rounds_per_question", 3)))
    tool_round = int(state.get("current_tool_round", 0))

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

    current_sources = state.get("current_sources", [])
    seed_source_limit = max(1, int(state.get("seed_source_limit", 8)))
    seed_ids = [src.get("id") for src in current_sources if src.get("id")][:seed_source_limit]

    max_parent_calls = max(0, int(state.get("max_parent_chunks_per_question", 2)))
    current_parent_calls = int(state.get("current_parent_calls", 0))
    parent_chunk_top_k = max(1, int(state.get("parent_chunk_top_k", 2)))
    parent_candidates: List[str] = []
    seen_parent_ids: set[str] = set()
    for source in current_sources:
        if source.get("is_parent"):
            continue

        parent_id = str(source.get("parent_id") or "").strip()
        if not parent_id or parent_id in seen_parent_ids:
            continue

        seen_parent_ids.add(parent_id)
        parent_candidates.append(parent_id)
        if len(parent_candidates) >= parent_chunk_top_k:
            break

    need_more_context = len(current_sources) < max(2, int(state.get("top_k", 10) // 2))
    can_expand = state.get("current_expand_calls", 0) < state.get("max_expand_calls_per_question", 2)

    if tool_round == 0:
        tool_name = "search_embeddings"
        tool_args = {
            "query": current_question,
            "top_k": state.get("top_k", 10),
            "min_score": state.get("min_score", 0.35),
        }
    elif max_parent_calls > 0 and current_parent_calls < max_parent_calls and parent_candidates:
        remaining_parent_calls = max_parent_calls - current_parent_calls
        parent_limit = min(parent_chunk_top_k, remaining_parent_calls)
        tool_name = "retrieve_parent_chunks"
        tool_args = {
            "parent_ids": parent_candidates[:parent_limit],
            "limit": parent_limit,
        }
    elif need_more_context and can_expand and seed_ids:
        tool_name = "expand_context"
        tool_args = {
            "seed_source_ids": seed_ids,
            "seed_query": current_question,
            "window_size": max(0, int(state.get("expand_context_window_size", 2))),
            "top_k": max(
                int(state.get("expand_context_top_k_min", 3)),
                int(state.get("top_k", 10) // 2),
            ),
            "min_score": max(
                0.0,
                float(state.get("min_score", 0.35))
                + float(state.get("expand_context_min_score_delta", -0.1)),
            ),
        }
    else:
        tool_name = "search_embeddings"
        tool_args = {
            "query": current_question,
            "top_k": max(6, int(state.get("top_k", 10))),
            "min_score": max(
                0.0,
                float(state.get("min_score", 0.35))
                + float(state.get("retry_search_min_score_delta", -0.08)),
            ),
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
                elif tool_name == "retrieve_parent_chunks":
                    sources = tools.retrieve_parent_chunks_tool(**tool_args)
                    state["current_parent_calls"] = int(state.get("current_parent_calls", 0)) + 1
                elif tool_name == "expand_context":
                    max_expand_calls = state.get("max_expand_calls_per_question", 2)
                    if state.get("current_expand_calls", 0) < max_expand_calls:
                        state["current_expand_calls"] = state.get("current_expand_calls", 0) + 1
                        sources = tools.expand_context_tool(**tool_args)
                    else:
                        sources = []
                else:
                    logger.warning("Unknown tool: %s", tool_name)
                    sources = []
                break
            except Exception as exc:  # pragma: no cover
                tool_error = str(exc)
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
        merged = _merge_sources(current_sources, indexed_sources)
        state["current_sources"] = merged

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
                "result_count": len(state.get("current_sources", [])),
                "sources": indexed_sources[:8],
            },
        )
        return state

    return run_tools_node


def judge_enough_node(state: AgenticRagState) -> AgenticRagState:
    """判断当前子问题是否可收敛。"""
    current_sources = state.get("current_sources", [])
    current_tool_round = int(state.get("current_tool_round", 0))
    max_tool_rounds = int(state.get("max_tool_rounds_per_question", 3))

    max_expand_calls = int(state.get("max_expand_calls_per_question", 2))
    current_expand_calls = int(state.get("current_expand_calls", 0))

    max_parent_calls = max(0, int(state.get("max_parent_chunks_per_question", 2)))
    current_parent_calls = int(state.get("current_parent_calls", 0))

    min_score = float(state.get("min_score", 0.35))
    finalize_min_sources = max(1, int(state.get("finalize_min_sources", 4)))
    finalize_min_high_confidence = max(1, int(state.get("finalize_min_high_confidence", 1)))
    min_sources_for_high_confidence = max(
        2,
        min(finalize_min_sources, max(2, int(state.get("top_k", 10) // 3))),
    )
    high_confidence = [src for src in current_sources if float(src.get("score") or 0.0) >= min_score]

    high_confidence_ready = (
        len(high_confidence) >= finalize_min_high_confidence
        and len(current_sources) >= min_sources_for_high_confidence
    )

    state["enough_for_finalize"] = (
        high_confidence_ready
        or len(current_sources) >= finalize_min_sources
        or current_tool_round >= max_tool_rounds
        or current_expand_calls >= max_expand_calls
        or (
            max_parent_calls > 0
            and current_parent_calls >= max_parent_calls
            and len(current_sources) >= max(1, finalize_min_high_confidence)
        )
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


def finalize_answer_node_factory(chat_client: ChatClient):
    """构建子问题回答生成节点。"""

    def finalize_answer_node(state: AgenticRagState) -> AgenticRagState:
        question = state.get("current_question") or ""
        sources = state.get("current_sources", [])
        question_index = int(state.get("current_question_index", 0)) + 1
        no_kb_answer = str(state.get("no_kb_answer") or NO_KB_ANSWER)

        append_event(
            state,
            "progress",
            {
                "stage": "aggregation",
                "message": f"第 {question_index} 个子问题证据收集完成，正在生成子答案",
            },
        )

        if not sources:
            answer = no_kb_answer
        else:
            evidence_lines: List[str] = []
            sorted_sources = sorted(
                sources,
                key=lambda item: (-(float(item.get("score") or 0.0)), int(item.get("index") or 0)),
            )

            evidence_max_sources = max(1, int(state.get("evidence_max_sources", 12)))
            snippet_max_chars = max(80, int(state.get("evidence_snippet_max_chars", 380)))

            for src in sorted_sources[:evidence_max_sources]:
                ref_index = src.get("index")
                title = src.get("title") or "未命名来源"
                snippet = _build_evidence_snippet(
                    source=src,
                    snippet_max_chars=snippet_max_chars,
                )
                evidence_lines.append(f"[ref:{ref_index}] 标题: {title} | 证据: {snippet}")

            answer = _generate_answer_with_evidence(
                state=state,
                chat_client=chat_client,
                question=question,
                question_index=int(state.get("current_question_index", 0)),
                evidence_lines=evidence_lines,
                max_tokens=int(state.get("answer_max_tokens", 800)),
                system_prompt=str(
                    state.get("answer_generation_system_prompt") or ""
                ),
                temperature=float(state.get("answer_generation_temperature", 0.2)),
                no_kb_answer=no_kb_answer,
            )

            if _should_force_recall_fallback(answer, no_kb_answer):
                answer = _build_recall_fallback_answer(
                    question=question,
                    sources=sources,
                    snippet_max_chars=snippet_max_chars,
                    no_kb_answer=no_kb_answer,
                )

            valid_refs = {
                int(src.get("index"))
                for src in sources
                if src.get("index") and str(src.get("index")).isdigit()
            }
            answer = _ensure_valid_refs(answer, valid_refs)
            if not answer.strip():
                answer = no_kb_answer
            if valid_refs and not REF_PATTERN.search(answer) and not _is_no_kb_like(answer, no_kb_answer):
                smallest = min(valid_refs)
                answer = f"{answer.rstrip()}[ref:{smallest}]"

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

    return finalize_answer_node


def aggregate_answers_node_factory(chat_client: ChatClient):
    """构建多子问题聚合节点。"""

    def aggregate_answers_node(state: AgenticRagState) -> AgenticRagState:
        question_answers = state.get("question_answers", [])
        no_kb_answer = str(state.get("no_kb_answer") or NO_KB_ANSWER)
        state["final_answer_prompt"] = ""

        append_event(
            state,
            "progress",
            {
                "stage": "aggregation",
                "message": f"已生成 {len(question_answers)} 个子答案，正在聚合最终回复",
            },
        )

        append_event(
            state,
            "aggregation",
            {
                "total_questions": len(state.get("rewritten_queries", [])),
                "completed": len(question_answers),
            },
        )

        if not question_answers:
            state["final_answer"] = no_kb_answer
            return state

        if len(question_answers) == 1:
            single_answer = str(
                question_answers[0].get("answer")
                or no_kb_answer
            )

            if _is_no_kb_like(single_answer, no_kb_answer):
                single_answer = _build_recall_fallback_answer(
                    question=str(state.get("original_query") or ""),
                    sources=state.get("all_sources", []),
                    snippet_max_chars=int(state.get("evidence_snippet_max_chars", 380)),
                    no_kb_answer=no_kb_answer,
                    max_items=8,
                )

            state["final_answer"] = single_answer

            if state.get("stream_output", True):
                user_prompt = (
                    f"原始问题：{state.get('original_query', '')}\n\n"
                    f"子问题回答：\n{single_answer}\n\n"
                    "请在不引入外部事实的前提下，整理为最终回答。"
                    "若输入中存在任何 [ref:N] 证据，禁止输出“知识库暂无相关信息”。"
                )
                state["final_answer_prompt"] = user_prompt
            return state

        answer_lines: List[str] = []
        for idx, item in enumerate(question_answers, start=1):
            sub_question = str(item.get("question") or "")
            sub_answer = str(item.get("answer") or "")
            answer_lines.append(f"子问题{idx}: {sub_question}\n子答案{idx}: {sub_answer}")

        merged_answers = "\n\n".join(answer_lines)
        user_prompt = (
            f"原始问题：{state.get('original_query', '')}\n\n"
            f"子问题回答：\n{merged_answers}\n\n"
            "请合并为最终回答。若输入中存在任何 [ref:N] 证据，"
            "禁止输出“知识库暂无相关信息”，而应整理为候选结论并保留引用。"
        )

        fallback_answer = _fallback_concat(question_answers, no_kb_answer)

        aggregation_system_prompt = str(state.get("aggregation_system_prompt") or "")
        aggregation_temperature = float(state.get("aggregation_temperature", 0.2))
        aggregation_max_tokens = max(500, int(state.get("answer_max_tokens", 800)) + 400)

        if _is_no_kb_like(fallback_answer, no_kb_answer):
            fallback_answer = _build_recall_fallback_answer(
                question=str(state.get("original_query") or ""),
                sources=state.get("all_sources", []),
                snippet_max_chars=int(state.get("evidence_snippet_max_chars", 380)),
                no_kb_answer=no_kb_answer,
                max_items=8,
            )

        if state.get("stream_output", True):
            state["final_answer_prompt"] = user_prompt
            state["final_answer"] = fallback_answer
            _append_llm_call_event(
                state,
                stage="aggregation_stream_prepare",
                system_prompt=aggregation_system_prompt,
                user_prompt=user_prompt,
                temperature=aggregation_temperature,
                max_tokens=aggregation_max_tokens,
                skipped=True,
                skip_reason="handled_in_service_stream",
            )
            return state

        try:
            aggregated = run_async_in_thread(
                chat_client.complete(
                    messages=[
                        {
                            "role": "system",
                            "content": aggregation_system_prompt,
                        },
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=aggregation_temperature,
                    max_tokens=aggregation_max_tokens,
                )
            )
            aggregated_text = str(aggregated or "").strip()
            _append_llm_call_event(
                state,
                stage="aggregation",
                system_prompt=aggregation_system_prompt,
                user_prompt=user_prompt,
                temperature=aggregation_temperature,
                max_tokens=aggregation_max_tokens,
                response=aggregated_text,
            )
            if _is_no_kb_like(aggregated_text, no_kb_answer) and not _is_no_kb_like(fallback_answer, no_kb_answer):
                state["final_answer"] = fallback_answer
            else:
                state["final_answer"] = aggregated_text or fallback_answer
        except Exception as exc:  # pragma: no cover
            logger.warning("aggregate answers failed: %s", exc)
            state["final_answer"] = fallback_answer
            _append_llm_call_event(
                state,
                stage="aggregation",
                system_prompt=aggregation_system_prompt,
                user_prompt=user_prompt,
                temperature=aggregation_temperature,
                max_tokens=aggregation_max_tokens,
                error=str(exc),
            )

        if not state["final_answer"].strip():
            state["final_answer"] = no_kb_answer
        return state

    return aggregate_answers_node


def _analyze_query_with_llm(
    state: AgenticRagState,
    chat_client: ChatClient,
    original_query: str,
    conversation_summary: str,
    max_split: int,
    system_prompt: str,
    temperature: float,
    max_tokens: int,
) -> Dict[str, Any]:
    payload = {
        "is_clear": True,
        "questions": [original_query],
        "clarification_needed": "",
        "reason": "fallback",
    }

    user_prompt = (
        f"conversation_summary:\n{conversation_summary or '无'}\n\n"
        f"current_query:\n{original_query}\n\n"
        f"max_split_questions={max_split}"
    )

    try:
        response_text = run_async_in_thread(
            chat_client.complete(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )
        )

        response_str = str(response_text or "")
        _append_llm_call_event(
            state,
            stage="query_analysis",
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            response=response_str,
        )

        parsed = _safe_parse_json(response_str)
        if not isinstance(parsed, dict):
            return payload

        questions = [str(item).strip() for item in parsed.get("questions", []) if str(item).strip()]
        if questions:
            questions = questions[:max_split]

        payload["is_clear"] = bool(parsed.get("is_clear"))
        payload["questions"] = questions or [original_query]
        payload["clarification_needed"] = str(parsed.get("clarification_needed") or "").strip()
        payload["reason"] = str(parsed.get("reason") or "").strip()
        return payload
    except Exception as exc:  # pragma: no cover
        logger.warning("query analysis with llm failed: %s", exc)
        _append_llm_call_event(
            state,
            stage="query_analysis",
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            error=str(exc),
        )
        return payload


def _should_split_query(query: str) -> bool:
    normalized = str(query or "").strip().lower()
    if not normalized:
        return False

    if any(hint in normalized for hint in MULTI_INTENT_HINTS):
        return True

    multi_question_marks = normalized.count("?") + normalized.count("？")
    if multi_question_marks >= 2:
        return True

    separators = normalized.count(";") + normalized.count("；") + normalized.count("/")
    if separators >= 2:
        return True

    return False


def _prefer_keyword_first_rewrite(query: str, conversation_summary: str) -> bool:
    clean_query = str(query or "").strip()
    if not clean_query:
        return False

    if _should_split_query(clean_query):
        return False

    if len(clean_query) > 64:
        return False

    if conversation_summary and len(clean_query) > 36:
        return False

    return True


def _sanitize_rewritten_queries(
    questions: List[str],
    original_query: str,
    max_split: int,
    allow_split: bool,
) -> List[str]:
    normalized_max_split = _normalize_max_split_questions(max_split)
    source_terms = set(_extract_query_terms(original_query))
    source_has_year = bool(YEAR_PATTERN.search(original_query))

    normalized: List[str] = []
    for item in questions:
        candidate = str(item or "").strip()
        if not candidate:
            continue

        candidate = EXAMPLE_PARENS_PATTERN.sub("", candidate)
        candidate = _compact_text(candidate)
        if not source_has_year:
            candidate = YEAR_PATTERN.sub("", candidate)
            candidate = _compact_text(candidate)

        if _looks_like_drift(candidate, source_terms):
            candidate = _build_keyword_focused_query(original_query)

        if candidate:
            normalized.append(candidate)

    deduped: List[str] = []
    used: set[str] = set()
    for item in normalized:
        key = item.lower()
        if key in used:
            continue
        used.add(key)
        deduped.append(item)

    if not allow_split and deduped:
        deduped = [deduped[0]]

    expanded = _expand_rewritten_queries_with_synonym_variants(
        queries=deduped,
        max_split=normalized_max_split,
    )

    return expanded[:normalized_max_split]


def _looks_like_drift(candidate: str, source_terms: set[str]) -> bool:
    if not candidate:
        return True

    if not source_terms:
        return False

    candidate_terms = set(_extract_query_terms(candidate))
    if len(candidate_terms) <= 2:
        return False

    overlap = len(candidate_terms & source_terms)
    overlap_ratio = overlap / max(1, len(candidate_terms))
    return overlap_ratio < 0.35


def _build_keyword_focused_query(query: str) -> str:
    cleaned = _strip_rewrite_noise(query)
    terms = _extract_query_terms(cleaned)
    if not terms:
        return _compact_text(query)
    return " ".join(terms[:8]).strip() or _compact_text(query)


def _expand_rewritten_queries_with_synonym_variants(queries: List[str], max_split: int) -> List[str]:
    normalized_max_split = _normalize_max_split_questions(max_split)
    expanded_queries: List[str] = []
    seen: set[str] = set()

    for query in queries:
        variants = _build_query_synonym_variants(query)
        for candidate in variants:
            key = candidate.lower()
            if key in seen:
                continue

            seen.add(key)
            expanded_queries.append(candidate)
            if len(expanded_queries) >= normalized_max_split:
                return expanded_queries

    return expanded_queries


def _build_query_synonym_variants(query: str) -> List[str]:
    base = _compact_text(query)
    if not base:
        return []

    variants = [base]
    variant_keys = {base.lower()}
    expansions = _collect_query_synonym_expansions(base, limit=SYNONYM_EXPANSION_LIMIT)
    for synonym in expansions:
        variant = _compact_text(f"{base} {synonym}")
        variant_key = variant.lower()
        if variant and variant_key not in variant_keys:
            variants.append(variant)
            variant_keys.add(variant_key)

    return variants


def _normalize_max_split_questions(max_split: Any) -> int:
    try:
        value = int(max_split)
    except Exception:
        value = 3

    return min(MAX_SPLIT_QUESTIONS_LIMIT, max(1, value))


def _collect_query_synonym_expansions(query: str, limit: int) -> List[str]:
    normalized_query = _normalize_synonym_text(query)
    if not normalized_query or limit <= 0:
        return []

    expansions: List[str] = []
    seen: set[str] = set()

    for group in QUERY_SYNONYM_GROUPS:
        group_hit = any(_query_contains_alias(normalized_query, alias) for alias in group)
        if not group_hit:
            continue

        for alias in group:
            if _query_contains_alias(normalized_query, alias):
                continue

            key = _normalize_synonym_text(alias)
            if not key or key in seen:
                continue

            seen.add(key)
            expansions.append(alias)
            if len(expansions) >= limit:
                return expansions

    return expansions


def _query_contains_alias(normalized_query: str, alias: str) -> bool:
    alias_norm = _normalize_synonym_text(alias)
    if not alias_norm:
        return False

    if re.search(r"[\u4e00-\u9fff]", alias_norm):
        return alias_norm in normalized_query

    pattern = rf"(?<![a-z0-9]){re.escape(alias_norm)}(?![a-z0-9])"
    return bool(re.search(pattern, normalized_query))


def _normalize_synonym_text(text: str) -> str:
    normalized = str(text or "").lower().replace("-", " ").replace("_", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _strip_rewrite_noise(text: str) -> str:
    cleaned = str(text or "")
    for phrase in REWRITE_NOISE_PHRASES:
        cleaned = cleaned.replace(phrase, " ")
    return _compact_text(cleaned)


def _extract_query_terms(text: str) -> List[str]:
    ordered_terms: List[str] = []
    seen: set[str] = set()

    for match in QUERY_TERM_PATTERN.findall(str(text or "").lower()):
        token = str(match or "").strip()
        if len(token) < 2:
            continue
        if token in QUERY_STOP_TERMS:
            continue
        if token in seen:
            continue
        seen.add(token)
        ordered_terms.append(token)

    return ordered_terms


def _compact_text(text: str) -> str:
    compacted = str(text or "").strip()
    compacted = re.sub(r"\s+", " ", compacted)
    compacted = compacted.strip(" ,，。；;、:\\：")
    return compacted


def _json_dumps_compact(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str)


def _generate_answer_with_evidence(
    state: AgenticRagState,
    chat_client: ChatClient,
    question: str,
    question_index: int,
    evidence_lines: List[str],
    max_tokens: int,
    system_prompt: str,
    temperature: float,
    no_kb_answer: str,
) -> str:
    if not evidence_lines:
        _append_llm_call_event(
            state,
            stage="answer_generation",
            system_prompt=system_prompt,
            user_prompt="",
            temperature=temperature,
            max_tokens=max(320, max_tokens),
            question=question,
            question_index=question_index,
            skipped=True,
            skip_reason="no_evidence",
        )
        return no_kb_answer

    evidence_text = "\n".join(evidence_lines)
    user_prompt = (
        f"用户问题：{question}\n\n"
        "检索证据（只可使用这些证据）：\n"
        f"{evidence_text}\n\n"
        "请输出最终回答。若证据中存在可引用信息，禁止输出“知识库暂无相关信息”，"
        "应先给出带 [ref:N] 的候选结论并明确可能存在噪声。"
    )

    try:
        result = run_async_in_thread(
            chat_client.complete(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature,
                max_tokens=max(320, max_tokens),
            )
        )
        answer_text = str(result or "").strip()
        _append_llm_call_event(
            state,
            stage="answer_generation",
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=max(320, max_tokens),
            question=question,
            question_index=question_index,
            response=answer_text,
        )
        return answer_text
    except Exception as exc:  # pragma: no cover
        logger.warning("answer generation failed: %s", exc)
        _append_llm_call_event(
            state,
            stage="answer_generation",
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=max(320, max_tokens),
            question=question,
            question_index=question_index,
            error=str(exc),
        )
        return no_kb_answer


def _safe_parse_json(text: str) -> Dict[str, Any] | None:
    cleaned = text.strip()
    if not cleaned:
        return None

    try:
        return json.loads(cleaned)
    except Exception:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    try:
        return json.loads(cleaned[start : end + 1])
    except Exception:
        return None


def _merge_sources(existing: List[Dict[str, Any]], incoming: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    source_map: Dict[str, Dict[str, Any]] = {}

    for item in existing + incoming:
        source_key = str(item.get("source_key") or "").strip()
        if not source_key:
            continue

        current_score = float(item.get("score") or 0.0)
        old = source_map.get(source_key)
        if old is None:
            source_map[source_key] = dict(item)
            continue

        old_score = float(old.get("score") or 0.0)
        if current_score > old_score:
            source_map[source_key] = dict(item)

    merged = list(source_map.values())
    merged.sort(key=lambda src: (-(float(src.get("score") or 0.0)), int(src.get("index") or 0)))
    return merged


def _build_evidence_snippet(source: Dict[str, Any], snippet_max_chars: int) -> str:
    """构建证据片段：repository 来源保留完整内容，其他来源按阈值截断。"""
    snippet = str(source.get("content") or "").strip().replace("\n", " ")
    if not snippet:
        return ""

    source_type = str(source.get("source_type") or "").strip().lower()
    is_repository = source_type == "repository" or bool(source.get("repository_id"))
    if is_repository:
        return snippet

    return snippet[: max(80, int(snippet_max_chars))]


def _ensure_valid_refs(answer: str, valid_refs: set[int]) -> str:
    if not answer or not valid_refs:
        return answer

    def _replace(match: re.Match[str]) -> str:
        ref = int(match.group(1))
        if ref in valid_refs:
            return match.group(0)
        return ""

    cleaned = REF_PATTERN.sub(_replace, answer)
    cleaned = re.sub(r"\s+\n", "\n", cleaned)
    return cleaned.strip()


def _fallback_concat(question_answers: List[Dict[str, Any]], no_kb_answer: str) -> str:
    parts = [
        str(item.get("answer") or "").strip()
        for item in question_answers
        if item.get("answer") and not _is_no_kb_like(str(item.get("answer") or ""), no_kb_answer)
    ]
    text = "\n\n".join([part for part in parts if part]).strip()
    if text:
        return text

    fallback_sources = _collect_sources_from_question_answers(question_answers)
    if fallback_sources:
        return _build_recall_fallback_answer(
            question="",
            sources=fallback_sources,
            snippet_max_chars=220,
            no_kb_answer=no_kb_answer,
            max_items=8,
        )

    return text or no_kb_answer


def _normalize_answer_text(text: str) -> str:
    normalized = str(text or "").strip().lower()
    normalized = re.sub(r"[\s\n\t\r。！？，、；：,.!?;:]", "", normalized)
    return normalized


def _is_no_kb_like(answer: str, no_kb_answer: str) -> bool:
    text = str(answer or "").strip()
    if not text:
        return True

    normalized = _normalize_answer_text(text)
    explicit_candidates = {
        _normalize_answer_text(no_kb_answer),
        _normalize_answer_text(NO_KB_ANSWER),
        _normalize_answer_text("知识库暂无相关信息"),
    }
    if normalized in explicit_candidates:
        return True

    if REF_PATTERN.search(text):
        return False

    return any(keyword in text for keyword in NO_KB_FALLBACK_KEYWORDS)


def _should_force_recall_fallback(answer: str, no_kb_answer: str) -> bool:
    text = str(answer or "").strip()
    if not text:
        return True
    return _is_no_kb_like(text, no_kb_answer)


def _build_recall_fallback_answer(
    question: str,
    sources: List[Dict[str, Any]],
    snippet_max_chars: int,
    no_kb_answer: str,
    max_items: int = 6,
) -> str:
    if not sources:
        return no_kb_answer

    safe_snippet_chars = max(80, int(snippet_max_chars))
    safe_max_items = max(1, int(max_items))

    ordered_sources = sorted(
        sources,
        key=lambda item: (-(float(item.get("score") or 0.0)), int(item.get("index") or 0)),
    )

    selected_lines: List[str] = []
    selected_keys: set[str] = set()
    for source in ordered_sources:
        source_key = str(
            source.get("source_key")
            or source.get("id")
            or f"{source.get('article_id') or ''}:{source.get('repository_id') or ''}:{source.get('chunk_index') or 0}"
        ).strip()
        if source_key and source_key in selected_keys:
            continue

        ref_text = str(source.get("index") or "").strip()
        if not ref_text.isdigit():
            continue

        title = str(source.get("title") or "未命名来源").strip()
        snippet = str(source.get("content") or "").strip().replace("\n", " ")
        if snippet:
            snippet = snippet[:safe_snippet_chars]

        if snippet:
            line = f"- {title}：{snippet}[ref:{int(ref_text)}]"
        else:
            line = f"- {title}[ref:{int(ref_text)}]"

        selected_lines.append(line)
        if source_key:
            selected_keys.add(source_key)
        if len(selected_lines) >= safe_max_items:
            break

    if not selected_lines:
        return no_kb_answer

    question_text = str(question or "").strip()
    if question_text:
        header = f"针对“{question_text}”，检索到以下候选线索（召回优先，可能含噪声）："
    else:
        header = "检索到以下候选线索（召回优先，可能含噪声）："

    return f"{header}\n" + "\n".join(selected_lines)


def _collect_sources_from_question_answers(question_answers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}
    for item in question_answers:
        for source in item.get("sources") or []:
            key = str(
                source.get("source_key")
                or source.get("id")
                or f"{source.get('article_id') or ''}:{source.get('repository_id') or ''}:{source.get('chunk_index') or 0}"
            ).strip()
            if not key:
                continue

            existing = merged.get(key)
            if existing is None:
                merged[key] = dict(source)
                continue

            if float(source.get("score") or 0.0) > float(existing.get("score") or 0.0):
                merged[key] = dict(source)

    return list(merged.values())
