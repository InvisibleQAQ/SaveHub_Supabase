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


def summarize_history_node_factory(chat_client: ChatClient):
    """构建会话摘要节点。"""

    def summarize_history_node(state: AgenticRagState) -> AgenticRagState:
        messages = state.get("messages", [])
        if not messages:
            state["error"] = "messages is empty"
            return state

        user_messages = [m for m in messages if m.get("role") == "user" and m.get("content")]
        last_user_query = str(user_messages[-1].get("content") if user_messages else "").strip()
        state["last_user_query"] = last_user_query

        if len(messages) < 4:
            state["conversation_summary"] = ""
            return state

        history_for_summary = messages[:-1][-6:]
        if not history_for_summary:
            state["conversation_summary"] = ""
            return state

        lines: List[str] = []
        for msg in history_for_summary:
            role = "用户" if msg.get("role") == "user" else "助手"
            content = str(msg.get("content") or "").strip()
            if content:
                lines.append(f"{role}: {content}")

        if not lines:
            state["conversation_summary"] = ""
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
                            "content": str(
                                state.get("history_summary_system_prompt")
                                or "你是精炼总结助手。"
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    temperature=float(state.get("history_summary_temperature", 0.1)),
                    max_tokens=int(state.get("history_summary_max_tokens", 160)),
                )
            )
            state["conversation_summary"] = str(summary or "").strip()
        except Exception as exc:  # pragma: no cover
            logger.warning("history summarization failed: %s", exc)
            state["conversation_summary"] = ""

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

        max_split = max(1, int(state.get("max_split_questions", 3)))

        analysis_payload = _analyze_query_with_llm(
            chat_client=chat_client,
            original_query=original_query,
            conversation_summary=summary,
            max_split=max_split,
            system_prompt=str(
                state.get("query_analysis_system_prompt") or ""
            ),
            temperature=float(state.get("query_analysis_temperature", 0.1)),
            max_tokens=int(state.get("query_analysis_max_tokens", 320)),
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

        rewritten_queries = [str(item).strip() for item in questions if str(item).strip()][:max_split]
        if not rewritten_queries:
            rewritten_queries = [original_query]

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

    need_more_context = len(current_sources) < max(2, int(state.get("top_k", 10) // 2))
    can_expand = state.get("current_expand_calls", 0) < state.get("max_expand_calls_per_question", 2)

    if tool_round == 0:
        tool_name = "search_embeddings"
        tool_args = {
            "query": current_question,
            "top_k": state.get("top_k", 10),
            "min_score": state.get("min_score", 0.35),
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

        append_event(
            state,
            "progress",
            {
                "stage": "aggregation",
                "message": f"第 {question_index} 个子问题证据收集完成，正在生成子答案",
            },
        )

        if not sources:
            answer = str(state.get("no_kb_answer") or NO_KB_ANSWER)
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
                snippet = str(src.get("content") or "").strip().replace("\n", " ")
                snippet = snippet[:snippet_max_chars]
                evidence_lines.append(f"[ref:{ref_index}] 标题: {title} | 证据: {snippet}")

            answer = _generate_answer_with_evidence(
                chat_client=chat_client,
                question=question,
                evidence_lines=evidence_lines,
                max_tokens=int(state.get("answer_max_tokens", 800)),
                system_prompt=str(
                    state.get("answer_generation_system_prompt") or ""
                ),
                temperature=float(state.get("answer_generation_temperature", 0.2)),
                no_kb_answer=str(state.get("no_kb_answer") or NO_KB_ANSWER),
            )

            valid_refs = {
                int(src.get("index"))
                for src in sources
                if src.get("index") and str(src.get("index")).isdigit()
            }
            answer = _ensure_valid_refs(answer, valid_refs)
            if not answer.strip():
                answer = str(state.get("no_kb_answer") or NO_KB_ANSWER)
            if valid_refs and not REF_PATTERN.search(answer):
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
            state["final_answer"] = str(state.get("no_kb_answer") or NO_KB_ANSWER)
            return state

        if len(question_answers) == 1:
            single_answer = str(
                question_answers[0].get("answer")
                or state.get("no_kb_answer")
                or NO_KB_ANSWER
            )
            state["final_answer"] = single_answer

            if state.get("stream_output", True):
                user_prompt = (
                    f"原始问题：{state.get('original_query', '')}\n\n"
                    f"子问题回答：\n{single_answer}\n\n"
                    "请在不引入外部事实的前提下，整理为最终回答。"
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
            "请合并为最终回答。"
        )

        fallback_answer = _fallback_concat(
            question_answers,
            str(state.get("no_kb_answer") or NO_KB_ANSWER),
        )

        if state.get("stream_output", True):
            state["final_answer_prompt"] = user_prompt
            state["final_answer"] = fallback_answer
            return state

        try:
            aggregated = run_async_in_thread(
                chat_client.complete(
                    messages=[
                        {
                            "role": "system",
                            "content": str(
                                state.get("aggregation_system_prompt") or ""
                            ),
                        },
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=float(state.get("aggregation_temperature", 0.2)),
                    max_tokens=max(500, int(state.get("answer_max_tokens", 800)) + 400),
                )
            )
            aggregated_text = str(aggregated or "").strip()
            state["final_answer"] = aggregated_text or fallback_answer
        except Exception as exc:  # pragma: no cover
            logger.warning("aggregate answers failed: %s", exc)
            state["final_answer"] = fallback_answer

        if not state["final_answer"].strip():
            state["final_answer"] = str(state.get("no_kb_answer") or NO_KB_ANSWER)
        return state

    return aggregate_answers_node


def _analyze_query_with_llm(
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

        parsed = _safe_parse_json(str(response_text or ""))
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
        return payload


def _generate_answer_with_evidence(
    chat_client: ChatClient,
    question: str,
    evidence_lines: List[str],
    max_tokens: int,
    system_prompt: str,
    temperature: float,
    no_kb_answer: str,
) -> str:
    if not evidence_lines:
        return no_kb_answer

    evidence_text = "\n".join(evidence_lines)
    user_prompt = (
        f"用户问题：{question}\n\n"
        "检索证据（只可使用这些证据）：\n"
        f"{evidence_text}\n\n"
        "请输出最终回答。"
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
        return str(result or "").strip()
    except Exception as exc:  # pragma: no cover
        logger.warning("answer generation failed: %s", exc)
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
    parts = [str(item.get("answer") or "").strip() for item in question_answers if item.get("answer")]
    text = "\n\n".join([part for part in parts if part]).strip()
    return text or no_kb_answer
