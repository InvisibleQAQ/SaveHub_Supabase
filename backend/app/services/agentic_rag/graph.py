"""Agentic-RAG LangGraph 图编排。"""

from langgraph.graph import END, START, StateGraph

from app.services.agentic_rag.edges import (
    clarification_next,
    dispatch_next,
    judge_enough_next,
)
from app.services.agentic_rag.nodes import (
    agent_reason_node,
    aggregate_answers_node,
    clarification_gate_node,
    dispatch_questions_node,
    finalize_answer_node,
    judge_enough_node,
    rewrite_and_split_node,
    run_tools_node_factory,
)
from app.services.agentic_rag.state import AgenticRagState
from app.services.agentic_rag.tools import AgenticRagTools


def build_agentic_rag_graph(tools: AgenticRagTools):
    """构建并编译 Agentic-RAG 图。"""
    graph = StateGraph(AgenticRagState)

    graph.add_node("rewrite_and_split", rewrite_and_split_node)
    graph.add_node("clarification_gate", clarification_gate_node)
    graph.add_node("dispatch_questions", dispatch_questions_node)
    graph.add_node("agent_reason", agent_reason_node)
    graph.add_node("run_tools", run_tools_node_factory(tools))
    graph.add_node("judge_enough", judge_enough_node)
    graph.add_node("finalize_answer", finalize_answer_node)
    graph.add_node("aggregate_answers", aggregate_answers_node)

    graph.add_edge(START, "rewrite_and_split")
    graph.add_edge("rewrite_and_split", "clarification_gate")

    graph.add_conditional_edges(
        "clarification_gate",
        clarification_next,
        {
            "dispatch_questions": "dispatch_questions",
            "end": END,
        },
    )

    graph.add_conditional_edges(
        "dispatch_questions",
        dispatch_next,
        {
            "agent_reason": "agent_reason",
            "aggregate_answers": "aggregate_answers",
        },
    )

    graph.add_edge("agent_reason", "run_tools")
    graph.add_edge("run_tools", "judge_enough")

    graph.add_conditional_edges(
        "judge_enough",
        judge_enough_next,
        {
            "finalize_answer": "finalize_answer",
            "agent_reason": "agent_reason",
        },
    )

    graph.add_edge("finalize_answer", "dispatch_questions")
    graph.add_edge("aggregate_answers", END)

    return graph.compile()

