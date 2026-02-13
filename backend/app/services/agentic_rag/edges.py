"""Agentic-RAG 图边条件。"""

from app.services.agentic_rag.state import AgenticRagState


def clarification_next(state: AgenticRagState) -> str:
    """澄清节点后的流向。"""
    if state.get("clarification_required"):
        return "end"

    if state.get("enable_parallel_map_reduce", True):
        return "map_reduce_questions"

    return "dispatch_questions"


def dispatch_next(state: AgenticRagState) -> str:
    """分发问题节点后的流向。"""
    if state.get("current_question"):
        return "agent_reason"
    return "aggregate_answers"


def judge_enough_next(state: AgenticRagState) -> str:
    """判断是否已足够生成答案。"""
    if state.get("enough_for_finalize"):
        return "finalize_answer"
    return "agent_reason"
