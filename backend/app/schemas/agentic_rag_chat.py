"""Agentic-RAG 流式问答请求模型。"""

from typing import List, Literal

from pydantic import BaseModel, Field


class AgenticChatMessage(BaseModel):
    """单条对话消息。"""

    role: Literal["user", "assistant"] = Field(..., description="消息角色")
    content: str = Field(..., min_length=1, description="消息内容")


class AgenticRagChatRequest(BaseModel):
    """Agentic-RAG 请求参数。"""

    messages: List[AgenticChatMessage] = Field(..., min_length=1, description="对话历史")
    top_k: int | None = Field(default=None, ge=1, le=30, description="检索文档数量")
    min_score: float | None = Field(default=None, ge=0.0, le=1.0, description="最小相似度阈值")
    max_split_questions: int | None = Field(default=None, ge=1, le=10, description="最多拆分子问题数")
    max_tool_rounds_per_question: int | None = Field(
        default=None,
        ge=1,
        le=8,
        description="每个子问题最多工具循环轮次",
    )
    max_expand_calls_per_question: int | None = Field(
        default=None,
        ge=0,
        le=6,
        description="每个子问题最多上下文扩展次数",
    )
    max_parent_chunks_per_question: int | None = Field(
        default=None,
        ge=0,
        le=6,
        description="每个子问题最多父块补全次数",
    )
    parent_chunk_top_k: int | None = Field(
        default=None,
        ge=1,
        le=6,
        description="单次父块补全最多回溯父块数量",
    )
    parent_chunk_span: int | None = Field(
        default=None,
        ge=1,
        le=12,
        description="动态父块覆盖的子块窗口大小",
    )
    retry_tool_on_failure: bool | None = Field(default=None, description="工具失败时是否重试")
    max_tool_retry: int | None = Field(default=None, ge=0, le=3, description="工具最大重试次数")
    answer_max_tokens: int | None = Field(
        default=None,
        ge=200,
        le=2200,
        description="答案最大生成长度",
    )
