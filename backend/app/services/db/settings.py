"""
Settings database service using Supabase Python SDK.

Mirrors the functionality of lib/db/settings.ts
"""

import logging
from datetime import datetime
from typing import Optional

from supabase import Client

logger = logging.getLogger(__name__)

# Default settings matching the frontend
DEFAULT_SETTINGS = {
    "theme": "system",
    "font_size": 16,
    "auto_refresh": True,
    "refresh_interval": 30,
    "articles_retention_days": 30,
    "mark_as_read_on_scroll": False,
    "show_thumbnails": True,
    "sidebar_pinned": False,
    "agentic_rag_top_k": 8,
    "agentic_rag_min_score": 0.35,
    "agentic_rag_max_split_questions": 3,
    "agentic_rag_max_tool_rounds_per_question": 3,
    "agentic_rag_max_expand_calls_per_question": 2,
    "agentic_rag_retry_tool_on_failure": True,
    "agentic_rag_max_tool_retry": 1,
    "agentic_rag_answer_max_tokens": 900,
    "agentic_rag_history_summary_temperature": 0.1,
    "agentic_rag_history_summary_max_tokens": 160,
    "agentic_rag_query_analysis_temperature": 0.1,
    "agentic_rag_query_analysis_max_tokens": 320,
    "agentic_rag_answer_generation_temperature": 0.2,
    "agentic_rag_aggregation_temperature": 0.2,
    "agentic_rag_expand_context_window_size": 2,
    "agentic_rag_expand_context_top_k_min": 3,
    "agentic_rag_expand_context_min_score_delta": -0.1,
    "agentic_rag_retry_search_min_score_delta": -0.08,
    "agentic_rag_seed_source_limit": 8,
    "agentic_rag_finalize_min_sources": 4,
    "agentic_rag_finalize_min_high_confidence": 1,
    "agentic_rag_evidence_max_sources": 12,
    "agentic_rag_evidence_snippet_max_chars": 380,
    "agentic_rag_source_content_max_chars": 700,
    "agentic_rag_query_analysis_system_prompt": """你是资深的 RAG 查询分析器。

你的职责：把用户问题改写成适合语义检索的自包含子问题，并判断是否需要澄清。

硬性规则：
1. 只能基于用户输入与对话历史，不得编造实体或条件。
2. 问题不清楚时必须标记为不清晰，并给出中文澄清问题。
3. 如果有多个独立信息需求，可拆成最多 3 个子问题。
4. 每个子问题都必须可直接检索，不允许“这个/那个/它”这类指代。

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
- reason: 20 字以内，用于日志简述""",
    "agentic_rag_clarification_prompt": "我还缺少关键信息。请补充你想查询的对象、时间范围、比较维度或具体场景。",
    "agentic_rag_answer_generation_system_prompt": """你是严格证据驱动的知识库问答助手。

你只能基于“检索证据”回答，禁止使用外部常识补全。

输出规则：
1. 每个关键结论后必须带引用标记 [ref:N]（N 来自证据编号）。
2. 不允许引用不存在的编号。
3. 若证据不足以回答，必须明确说“知识库暂无相关信息”。
4. 回答用中文，简洁且信息完整。""",
    "agentic_rag_aggregation_system_prompt": """你是多子问题答案聚合助手。

目标：把多个基于证据的答案整合成一段自然、完整、去重的最终回答。

规则：
1. 只使用输入答案里的事实，不新增外部知识。
2. 保留并复用原有 [ref:N] 引用。
3. 若不同答案重复，进行合并；若冲突，保留冲突并说明。
4. 若所有子答案都缺乏信息，输出“知识库暂无相关信息”。""",
    "agentic_rag_no_kb_answer": "知识库暂无相关信息。",
    "agentic_rag_history_summary_system_prompt": "你是精炼总结助手。",
    "agentic_rag_history_summary_user_prompt_template": "你是对话摘要助手。请把以下历史对话压缩为 1-2 句中文摘要，保留主题、关键实体和未解决问题。只输出摘要正文。",
}


class SettingsService:
    """Service for settings database operations."""

    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    def save_settings(self, settings: dict) -> None:
        """
        Save user settings to database.
        Upserts settings for current user.

        Args:
            settings: Settings dictionary
        """
        db_settings = {"user_id": self.user_id, "updated_at": datetime.utcnow().isoformat()}
        for key, default_value in DEFAULT_SETTINGS.items():
            db_settings[key] = settings.get(key, default_value)

        db_settings["github_token"] = settings.get("github_token")

        logger.debug(f"Saving settings for user {self.user_id}")

        self.supabase.table("settings").upsert(db_settings).execute()

        logger.info(f"Saved settings for user {self.user_id}")

    def load_settings(self) -> Optional[dict]:
        """
        Load user settings from database.
        Returns None if no settings found for user.

        Returns:
            Settings dictionary or None
        """
        try:
            response = self.supabase.table("settings") \
                .select("*") \
                .eq("user_id", self.user_id) \
                .single() \
                .execute()

            if response.data:
                row = response.data
                result = {
                    "user_id": row["user_id"],
                    "github_token": row.get("github_token"),
                    "updated_at": row.get("updated_at"),
                }

                for key, default_value in DEFAULT_SETTINGS.items():
                    result[key] = row.get(key, default_value)

                return result
            return None
        except Exception as e:
            # PGRST116 = no rows found
            if "PGRST116" in str(e):
                return None
            logger.error(f"Failed to load settings: {e}")
            raise

    def update_settings(self, updates: dict) -> None:
        """
        Update specific fields of settings.
        Only updates provided fields.

        Args:
            updates: Dictionary of fields to update
        """
        update_data = {"updated_at": datetime.utcnow().isoformat()}

        supported_fields = set(DEFAULT_SETTINGS.keys()) | {"github_token"}

        for key in supported_fields:
            if key in updates:
                update_data[key] = updates[key]

        logger.debug(f"Updating settings: {list(update_data.keys())}")

        self.supabase.table("settings") \
            .update(update_data) \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Updated settings for user {self.user_id}")

    def delete_settings(self) -> None:
        """Delete user settings."""
        self.supabase.table("settings") \
            .delete() \
            .eq("user_id", self.user_id) \
            .execute()

        logger.info(f"Deleted settings for user {self.user_id}")
