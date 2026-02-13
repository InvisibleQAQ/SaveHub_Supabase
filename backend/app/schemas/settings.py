"""Settings Pydantic schemas for request/response validation."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


class SettingsBase(BaseModel):
    """Base settings model with common fields."""

    theme: Literal["light", "dark", "system"] = "system"
    font_size: int = 16
    auto_refresh: bool = True
    refresh_interval: int = 30
    articles_retention_days: int = 30
    mark_as_read_on_scroll: bool = False
    show_thumbnails: bool = True
    sidebar_pinned: bool = False
    github_token: Optional[str] = None

    agentic_rag_top_k: int = 10
    agentic_rag_min_score: float = 0.22
    agentic_rag_max_split_questions: int = 3
    agentic_rag_max_tool_rounds_per_question: int = 3
    agentic_rag_max_expand_calls_per_question: int = 2
    agentic_rag_retry_tool_on_failure: bool = True
    agentic_rag_max_tool_retry: int = 1
    agentic_rag_answer_max_tokens: int = 900

    agentic_rag_history_summary_temperature: float = 0.1
    agentic_rag_history_summary_max_tokens: int = 160
    agentic_rag_query_analysis_temperature: float = 0.1
    agentic_rag_query_analysis_max_tokens: int = 320
    agentic_rag_answer_generation_temperature: float = 0.2
    agentic_rag_aggregation_temperature: float = 0.2

    agentic_rag_expand_context_window_size: int = 2
    agentic_rag_expand_context_top_k_min: int = 4
    agentic_rag_expand_context_min_score_delta: float = -0.1
    agentic_rag_retry_search_min_score_delta: float = -0.15
    agentic_rag_seed_source_limit: int = 8

    agentic_rag_finalize_min_sources: int = 5
    agentic_rag_finalize_min_high_confidence: int = 1
    agentic_rag_evidence_max_sources: int = 12
    agentic_rag_evidence_snippet_max_chars: int = 380
    agentic_rag_source_content_max_chars: int = 700

    agentic_rag_query_analysis_system_prompt: str = """你是资深的 RAG 查询分析器。

你的职责：把用户问题改写成适合语义检索的自包含子问题，并判断是否需要澄清。

硬性规则：
1. 只能基于用户输入与对话历史，不得编造实体或条件。
2. 问题不清楚时必须标记为不清晰，并给出中文澄清问题。
3. 如果有多个独立信息需求，可拆成多个子问题，最多 10 个（仍应遵循 max_split_questions）。
4. 改写必须“最小改动”：优先保留用户原关键词，不要自动加入年份、企业级/轻量级等额外限定，不要自行点名具体项目或示例；在不改变意图时，可补充 1-2 个高置信同义词/缩写全称（如 RAG ↔ Retrieval-Augmented Generation ↔ 检索增强生成）。
5. 每个子问题都必须可直接检索，不允许“这个/那个/它”这类指代。

请只输出 JSON（不要 markdown），结构必须是：
{
  "is_clear": true,
  "questions": ["..."],
  "clarification_needed": "...",
  "reason": "..."
}

字段约束：
- is_clear: 布尔值
- questions: 字符串数组；is_clear=true 时至少 1 条
- clarification_needed: is_clear=false 时必须是可直接发给用户的中文追问
- reason: 20 字以内，用于日志简述"""

    agentic_rag_clarification_prompt: str = (
        "我还缺少关键信息。请补充你想查询的对象、时间范围、比较维度或具体场景。"
    )

    agentic_rag_answer_generation_system_prompt: str = """你是严格证据驱动的知识库问答助手。

你只能基于“检索证据”回答，禁止使用外部常识补全。

输出规则：
1. 每个关键结论后必须带引用标记 [ref:N]（N 来自证据编号）。
2. 不允许引用不存在的编号。
3. 召回优先：若有任何可引用证据，先输出带 [ref:N] 的候选结论并提示可能含噪声；仅在完全无证据时输出“知识库暂无相关信息”。
4. 回答用中文，简洁且信息完整。"""

    agentic_rag_aggregation_system_prompt: str = """你是多子问题答案聚合助手。

目标：把多个基于证据的答案整合成一段自然、完整、去重的最终回答。

规则：
1. 只使用输入答案里的事实，不新增外部知识。
2. 保留并复用原有 [ref:N] 引用。
3. 若不同答案重复，进行合并；若冲突，保留冲突并说明。
4. 若存在任一子答案含有效 [ref:N] 证据，禁止输出“知识库暂无相关信息”；仅在全部子答案都无证据时输出。"""

    agentic_rag_no_kb_answer: str = "知识库暂无相关信息。"
    agentic_rag_history_summary_system_prompt: str = "你是精炼总结助手。"
    agentic_rag_history_summary_user_prompt_template: str = (
        "你是对话摘要助手。请把以下历史对话压缩为 1-2 句中文摘要，"
        "保留主题、关键实体和未解决问题。只输出摘要正文。"
    )


class SettingsCreate(SettingsBase):
    """Request model for creating settings."""
    pass


class SettingsUpdate(BaseModel):
    """Request model for updating settings (all fields optional)."""

    theme: Optional[Literal["light", "dark", "system"]] = None
    font_size: Optional[int] = None
    auto_refresh: Optional[bool] = None
    refresh_interval: Optional[int] = None
    articles_retention_days: Optional[int] = None
    mark_as_read_on_scroll: Optional[bool] = None
    show_thumbnails: Optional[bool] = None
    sidebar_pinned: Optional[bool] = None
    github_token: Optional[str] = None

    agentic_rag_top_k: Optional[int] = None
    agentic_rag_min_score: Optional[float] = None
    agentic_rag_max_split_questions: Optional[int] = None
    agentic_rag_max_tool_rounds_per_question: Optional[int] = None
    agentic_rag_max_expand_calls_per_question: Optional[int] = None
    agentic_rag_retry_tool_on_failure: Optional[bool] = None
    agentic_rag_max_tool_retry: Optional[int] = None
    agentic_rag_answer_max_tokens: Optional[int] = None

    agentic_rag_history_summary_temperature: Optional[float] = None
    agentic_rag_history_summary_max_tokens: Optional[int] = None
    agentic_rag_query_analysis_temperature: Optional[float] = None
    agentic_rag_query_analysis_max_tokens: Optional[int] = None
    agentic_rag_answer_generation_temperature: Optional[float] = None
    agentic_rag_aggregation_temperature: Optional[float] = None

    agentic_rag_expand_context_window_size: Optional[int] = None
    agentic_rag_expand_context_top_k_min: Optional[int] = None
    agentic_rag_expand_context_min_score_delta: Optional[float] = None
    agentic_rag_retry_search_min_score_delta: Optional[float] = None
    agentic_rag_seed_source_limit: Optional[int] = None

    agentic_rag_finalize_min_sources: Optional[int] = None
    agentic_rag_finalize_min_high_confidence: Optional[int] = None
    agentic_rag_evidence_max_sources: Optional[int] = None
    agentic_rag_evidence_snippet_max_chars: Optional[int] = None
    agentic_rag_source_content_max_chars: Optional[int] = None

    agentic_rag_query_analysis_system_prompt: Optional[str] = None
    agentic_rag_clarification_prompt: Optional[str] = None
    agentic_rag_answer_generation_system_prompt: Optional[str] = None
    agentic_rag_aggregation_system_prompt: Optional[str] = None
    agentic_rag_no_kb_answer: Optional[str] = None
    agentic_rag_history_summary_system_prompt: Optional[str] = None
    agentic_rag_history_summary_user_prompt_template: Optional[str] = None


class SettingsResponse(SettingsBase):
    """Response model for settings."""
    user_id: str
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Default settings
DEFAULT_SETTINGS = SettingsBase()
