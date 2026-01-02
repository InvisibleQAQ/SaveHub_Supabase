"""
RAG Chat 请求/响应模型。

用于 Self-RAG 问答功能的 Pydantic 模型定义。
"""

from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """单条对话消息"""
    role: Literal["user", "assistant"] = Field(..., description="消息角色")
    content: str = Field(..., min_length=1, description="消息内容")


class RagChatRequest(BaseModel):
    """RAG Chat 请求"""
    messages: List[ChatMessage] = Field(..., min_length=1, description="对话历史")
    top_k: int = Field(default=10, ge=1, le=30, description="检索文档数量")
    min_score: float = Field(default=0.3, ge=0.0, le=1.0, description="最小相似度阈值")


class RetrievedSource(BaseModel):
    """检索到的来源"""
    id: str
    index: int = Field(..., ge=1, description="来源索引，从1开始，用于引用标记")
    content: str = Field(..., description="内容片段")
    score: float = Field(..., ge=0.0, le=1.0, description="相似度分数")
    source_type: Literal["article", "repository"] = Field(..., description="来源类型")
    title: str = Field(..., description="标题")
    url: Optional[str] = Field(None, description="链接")
    # Repository 专用字段（用于引用卡片显示）
    owner_login: Optional[str] = Field(None, description="仓库所有者用户名")
    owner_avatar_url: Optional[str] = Field(None, description="所有者头像URL")
    stargazers_count: Optional[int] = Field(None, description="Star数量")
    language: Optional[str] = Field(None, description="主要编程语言")
    description: Optional[str] = Field(None, description="仓库描述")


class RagChatResponse(BaseModel):
    """RAG Chat 非流式响应（备用）"""
    answer: str
    sources: List[RetrievedSource]
    needs_retrieval: bool
    supported: bool
    utility: float
