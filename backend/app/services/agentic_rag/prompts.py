"""Agentic-RAG 提示词模板（Phase 1 骨架版）。"""

REWRITE_PROMPT = """你是查询重写助手。将用户问题改写成自包含问题，可拆分为最多3个子问题。"""

CLARIFICATION_PROMPT = """问题信息不足，请补充你想了解的具体对象、范围或维度。"""

NO_KB_ANSWER = "知识库暂无相关信息。"

