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
    top_k: int = Field(default=8, ge=1, le=30, description="检索文档数量")
    min_score: float = Field(default=0.35, ge=0.0, le=1.0, description="最小相似度阈值")
    max_split_questions: int = Field(default=3, ge=1, le=6, description="最多拆分子问题数")
    max_tool_rounds_per_question: int = Field(
        default=3,
        ge=1,
        le=8,
        description="每个子问题最多工具循环轮次",
    )
    max_expand_calls_per_question: int = Field(
        default=2,
        ge=0,
        le=6,
        description="每个子问题最多上下文扩展次数",
    )
    retry_tool_on_failure: bool = Field(default=True, description="工具失败时是否重试")
    max_tool_retry: int = Field(default=1, ge=0, le=3, description="工具最大重试次数")
