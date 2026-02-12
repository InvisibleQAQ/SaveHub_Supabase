"""Agentic-RAG 调试 Markdown 日志导出。"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.agentic_rag.state import AgenticRagState


def write_agentic_rag_trace_markdown(
    *,
    user_id: str,
    chat_model: str,
    embedding_model: str,
    messages: List[Dict[str, str]],
    request_params: Dict[str, Any],
    raw_events: List[Dict[str, Any]],
    sse_events: List[Dict[str, Any]],
    final_state: Optional[AgenticRagState],
    started_at: datetime,
    finished_at: datetime,
    output_dir: Optional[str] = None,
    error_message: Optional[str] = None,
) -> Path:
    """写入单次 Agentic-RAG 全流程调试日志。"""
    base_dir = _resolve_trace_dir(output_dir)
    base_dir.mkdir(parents=True, exist_ok=True)

    last_user_query = _extract_last_user_query(messages)
    run_id = finished_at.strftime("%Y%m%d-%H%M%S-%f")
    safe_query = _safe_filename_text(last_user_query)
    file_path = base_dir / f"{run_id}_{safe_query}.md"

    markdown = _build_markdown(
        run_id=run_id,
        user_id=user_id,
        chat_model=chat_model,
        embedding_model=embedding_model,
        messages=messages,
        request_params=request_params,
        raw_events=raw_events,
        sse_events=sse_events,
        final_state=final_state,
        started_at=started_at,
        finished_at=finished_at,
        error_message=error_message,
    )
    file_path.write_text(markdown, encoding="utf-8")
    return file_path


def _build_markdown(
    *,
    run_id: str,
    user_id: str,
    chat_model: str,
    embedding_model: str,
    messages: List[Dict[str, str]],
    request_params: Dict[str, Any],
    raw_events: List[Dict[str, Any]],
    sse_events: List[Dict[str, Any]],
    final_state: Optional[AgenticRagState],
    started_at: datetime,
    finished_at: datetime,
    error_message: Optional[str],
) -> str:
    rewritten_queries = list((final_state or {}).get("rewritten_queries") or [])
    question_answers = list((final_state or {}).get("question_answers") or [])
    final_answer = str((final_state or {}).get("final_answer") or "").strip()
    clarification_required = bool((final_state or {}).get("clarification_required"))
    clarification_message = str((final_state or {}).get("clarification_message") or "").strip()

    llm_calls = [event for event in raw_events if str(event.get("event") or "") == "llm_call"]
    query_analysis_call = _find_llm_call(llm_calls, stage="query_analysis")
    history_summary_call = _find_llm_call(llm_calls, stage="history_summary")
    aggregation_calls = [
        event for event in llm_calls if str((event.get("data") or {}).get("stage") or "").startswith("aggregation")
    ]

    question_steps = _build_question_steps(raw_events)

    lines: List[str] = []
    lines.append(f"# Agentic-RAG 调试日志（{run_id}）")
    lines.append("")
    lines.append("## 1) 请求信息")
    lines.append(f"- 开始时间: {started_at.isoformat()}")
    lines.append(f"- 结束时间: {finished_at.isoformat()}")
    lines.append(f"- user_id: `{user_id}`")
    lines.append(f"- chat_model: `{chat_model}`")
    lines.append(f"- embedding_model: `{embedding_model}`")
    lines.append(f"- 原始事件数: {len(raw_events)}")
    lines.append(f"- SSE 事件数: {len(sse_events)}")
    lines.append("")
    lines.append("### 入参（messages）")
    lines.append(_code_block(_json_pretty(messages), language="json"))
    lines.append("")
    lines.append("### 入参（检索/生成参数）")
    lines.append(_code_block(_json_pretty(request_params), language="json"))
    lines.append("")

    lines.append("## 2) 重写与澄清")
    rewrite_event = _first_event(raw_events, "rewrite")
    if rewrite_event:
        lines.append("### rewrite 事件")
        lines.append(_code_block(_json_pretty(rewrite_event.get("data") or {}), language="json"))
        lines.append("")
    if query_analysis_call:
        lines.append("### LLM: query_analysis")
        lines.extend(_render_llm_call(query_analysis_call.get("data") or {}))
        lines.append("")
    if history_summary_call:
        lines.append("### LLM: history_summary")
        lines.extend(_render_llm_call(history_summary_call.get("data") or {}))
        lines.append("")
    if clarification_required:
        lines.append("### 澄清状态")
        lines.append(_code_block(clarification_message or "clarification_required=true", language="text"))
        lines.append("")

    lines.append("## 3) 子问题执行全流程")
    if rewritten_queries:
        lines.append("### 子问题列表")
        for idx, query in enumerate(rewritten_queries, start=1):
            lines.append(f"- Q{idx}: {query}")
        lines.append("")

    if question_steps:
        for q_index in sorted(question_steps.keys()):
            one_based = q_index + 1
            detail = question_steps[q_index]
            question_text = str(detail.get("question") or "").strip()
            lines.append(f"### 子问题 {one_based}")
            if question_text:
                lines.append(f"- 问题: {question_text}")

            tool_calls = detail.get("tool_calls") or []
            tool_results = detail.get("tool_results") or []
            answer_llm = detail.get("answer_llm") or []

            if tool_calls:
                lines.append("- 工具调用:")
                for item in tool_calls:
                    data = item.get("data") or {}
                    tool_name = data.get("tool_name")
                    args = data.get("args")
                    lines.append(f"  - `{tool_name}` args={_json_compact(args)}")

            if tool_results:
                lines.append("- 工具结果:")
                for item in tool_results:
                    data = item.get("data") or {}
                    tool_name = data.get("tool_name")
                    result_count = data.get("result_count")
                    lines.append(f"  - `{tool_name}` result_count={result_count}")
                    source_lines = _summarize_sources(data.get("sources") or [])
                    for source_line in source_lines:
                        lines.append(f"    - {source_line}")

            if answer_llm:
                for llm_event in answer_llm:
                    lines.append("- LLM 生成子答案:")
                    lines.extend(_indent_lines(_render_llm_call(llm_event.get("data") or {}), prefix="  "))

            matched_answer = _find_question_answer(question_answers, question_text, q_index)
            if matched_answer:
                lines.append("- 子答案:")
                lines.append(_indent_block(_code_block(matched_answer, language="text"), prefix="  "))
            lines.append("")
    else:
        lines.append("- 无子问题执行记录")
        lines.append("")

    lines.append("## 4) 聚合与最终回答")
    if aggregation_calls:
        for idx, aggregation_call in enumerate(aggregation_calls, start=1):
            lines.append(f"### 聚合 LLM 调用 {idx}")
            lines.extend(_render_llm_call(aggregation_call.get("data") or {}))
            lines.append("")
    else:
        lines.append("- 未记录聚合 LLM 调用")
        lines.append("")

    lines.append("### 最终回答")
    lines.append(_code_block(final_answer or "(空)", language="text"))
    lines.append("")

    if error_message:
        lines.append("### 运行错误")
        lines.append(_code_block(error_message, language="text"))
        lines.append("")

    lines.append("## 5) 事件时间线")
    lines.append("| # | event | 摘要 |")
    lines.append("|---|---|---|")
    for idx, event in enumerate(raw_events, start=1):
        event_name = str(event.get("event") or "")
        summary = _event_summary(event)
        lines.append(f"| {idx} | `{event_name}` | {_escape_table_cell(summary)} |")
    lines.append("")

    lines.append("## 6) 原始事件（JSON）")
    lines.append(_code_block(_json_pretty(raw_events), language="json"))
    lines.append("")

    return "\n".join(lines).strip() + "\n"


def _build_question_steps(raw_events: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    question_steps: Dict[int, Dict[str, Any]] = {}
    for event in raw_events:
        event_name = str(event.get("event") or "")
        data = event.get("data") or {}

        question_index = data.get("question_index")
        if question_index is None:
            continue
        if not str(question_index).isdigit():
            continue

        idx = int(question_index)
        if idx not in question_steps:
            question_steps[idx] = {
                "question": "",
                "tool_calls": [],
                "tool_results": [],
                "answer_llm": [],
            }

        item = question_steps[idx]
        if event_name == "tool_call":
            question_text = str((data.get("args") or {}).get("query") or (data.get("args") or {}).get("seed_query") or "").strip()
            if question_text and not item.get("question"):
                item["question"] = question_text
            item["tool_calls"].append(event)
        elif event_name == "tool_result":
            item["tool_results"].append(event)
        elif event_name == "llm_call" and str(data.get("stage") or "") == "answer_generation":
            question_text = str(data.get("question") or "").strip()
            if question_text and not item.get("question"):
                item["question"] = question_text
            item["answer_llm"].append(event)

    return question_steps


def _find_question_answer(question_answers: List[Dict[str, Any]], question_text: str, index: int) -> str:
    if question_text:
        for item in question_answers:
            if str(item.get("question") or "").strip() == question_text:
                return str(item.get("answer") or "").strip()

    if 0 <= index < len(question_answers):
        return str(question_answers[index].get("answer") or "").strip()
    return ""


def _find_llm_call(events: List[Dict[str, Any]], stage: str) -> Optional[Dict[str, Any]]:
    for event in events:
        data = event.get("data") or {}
        if str(data.get("stage") or "") == stage:
            return event
    return None


def _summarize_sources(sources: List[Dict[str, Any]]) -> List[str]:
    lines: List[str] = []
    for source in sources[:8]:
        ref = source.get("index")
        title = str(source.get("title") or "未命名来源").strip()
        score = float(source.get("score") or 0.0)
        snippet = str(source.get("content") or "").strip().replace("\n", " ")[:120]
        ref_text = f"ref:{ref}" if str(ref).isdigit() else "ref:?"
        if snippet:
            lines.append(f"[{ref_text}] {title} (score={score:.4f}) -> {snippet}")
        else:
            lines.append(f"[{ref_text}] {title} (score={score:.4f})")
    return lines


def _render_llm_call(data: Dict[str, Any]) -> List[str]:
    stage = str(data.get("stage") or "").strip()
    question_index = data.get("question_index")
    stage_line = f"- stage: `{stage}`"
    if str(question_index).isdigit():
        stage_line += f" (question_index={int(question_index)})"

    lines = [
        stage_line,
        f"- temperature: `{data.get('temperature')}`",
        f"- max_tokens: `{data.get('max_tokens')}`",
    ]

    if data.get("skipped"):
        lines.append(f"- skipped: `{data.get('skip_reason') or 'unknown'}`")

    system_prompt = str(data.get("system_prompt") or "").strip()
    user_prompt = str(data.get("user_prompt") or "").strip()
    response = str(data.get("response") or "").strip()
    error = str(data.get("error") or "").strip()

    if data.get("question"):
        lines.append(f"- question: `{str(data.get('question') or '').strip()}`")

    if system_prompt:
        lines.append("- system_prompt:")
        lines.append(_indent_block(_code_block(system_prompt, language="text"), prefix="  "))

    if user_prompt:
        lines.append("- user_prompt/context:")
        lines.append(_indent_block(_code_block(user_prompt, language="text"), prefix="  "))

    if response:
        lines.append("- response:")
        lines.append(_indent_block(_code_block(response, language="text"), prefix="  "))

    if error:
        lines.append("- error:")
        lines.append(_indent_block(_code_block(error, language="text"), prefix="  "))

    return lines


def _event_summary(event: Dict[str, Any]) -> str:
    event_name = str(event.get("event") or "")
    data = event.get("data") or {}

    if event_name == "progress":
        return str(data.get("message") or "")
    if event_name == "rewrite":
        count = data.get("count")
        return f"rewritten_count={count}"
    if event_name == "tool_call":
        return f"tool={data.get('tool_name')}"
    if event_name == "tool_result":
        return f"tool={data.get('tool_name')} result_count={data.get('result_count')}"
    if event_name == "aggregation":
        return f"completed={data.get('completed')} total={data.get('total_questions')}"
    if event_name == "llm_call":
        stage = data.get("stage")
        q = data.get("question_index")
        if str(q).isdigit():
            return f"stage={stage} question_index={q}"
        return f"stage={stage}"
    if event_name == "done":
        return str(data.get("message") or "")
    if event_name == "error":
        return str(data.get("message") or "")
    if event_name == "content":
        delta = str(data.get("delta") or "").strip().replace("\n", " ")
        if len(delta) > 100:
            delta = f"{delta[:100]}..."
        return delta
    return _json_compact(data)


def _resolve_trace_dir(output_dir: Optional[str]) -> Path:
    if output_dir and str(output_dir).strip():
        return Path(str(output_dir).strip()).expanduser()
    return Path(__file__).resolve().parents[4] / "logs" / "agentic-rag-traces"


def _extract_last_user_query(messages: List[Dict[str, str]]) -> str:
    for msg in reversed(messages):
        if str(msg.get("role") or "").strip() == "user":
            content = str(msg.get("content") or "").strip()
            if content:
                return content
    return "query"


def _safe_filename_text(text: str, max_len: int = 42) -> str:
    normalized = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", str(text or "").strip())
    normalized = normalized.strip("_")
    if not normalized:
        return "query"
    return normalized[:max_len]


def _json_pretty(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, default=str)


def _json_compact(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str)


def _escape_table_cell(text: str) -> str:
    return str(text or "").replace("|", "\\|").replace("\n", "<br>")


def _code_block(text: str, language: str = "") -> str:
    safe_text = str(text or "").replace("```", "``\\`")
    return f"```{language}\n{safe_text}\n```"


def _indent_lines(lines: List[str], prefix: str) -> List[str]:
    return [f"{prefix}{line}" if line else line for line in lines]


def _indent_block(text: str, prefix: str) -> str:
    return "\n".join([f"{prefix}{line}" if line else line for line in text.splitlines()])


def _first_event(raw_events: List[Dict[str, Any]], event_name: str) -> Optional[Dict[str, Any]]:
    for event in raw_events:
        if str(event.get("event") or "") == event_name:
            return event
    return None
