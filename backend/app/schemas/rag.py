"""
RAG API Pydantic 模型。

定义 RAG 相关 API 的请求和响应模型。
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# =============================================================================
# Request Models
# =============================================================================

class RagQueryRequest(BaseModel):
    """RAG 查询请求"""

    query: str = Field(..., min_length=1, max_length=2000, description="查询问题")
    top_k: int = Field(default=10, ge=1, le=50, description="返回结果数量")
    feed_id: Optional[UUID] = Field(default=None, description="限定在特定 Feed 内搜索")
    min_score: float = Field(default=0.0, ge=0.0, le=1.0, description="最小相似度阈值")
    generate_answer: bool = Field(default=False, description="是否使用 LLM 生成答案")


class RagReindexRequest(BaseModel):
    """重新索引请求"""

    force: bool = Field(default=False, description="强制重新索引（即使已处理）")


# =============================================================================
# Response Models
# =============================================================================

class RagHit(BaseModel):
    """单条搜索结果"""

    id: UUID = Field(..., description="Embedding ID")
    article_id: UUID = Field(..., description="文章 ID")
    chunk_index: int = Field(..., description="块索引")
    content: str = Field(..., description="内容文本（含图片描述）")
    score: float = Field(..., description="相似度分数 (0-1)")
    article_title: str = Field(..., description="文章标题")
    article_url: str = Field(..., description="文章 URL")

    class Config:
        from_attributes = True


class RagQueryResponse(BaseModel):
    """RAG 查询响应"""

    query: str = Field(..., description="原始查询")
    hits: List[RagHit] = Field(default_factory=list, description="搜索结果列表")
    answer: Optional[str] = Field(default=None, description="LLM 生成的答案")
    total_hits: int = Field(..., description="总结果数")


class RagStatusResponse(BaseModel):
    """RAG 状态响应"""

    total_articles: int = Field(..., description="文章总数")
    rag_processed: int = Field(..., description="已处理的文章数")
    rag_pending: int = Field(..., description="待处理的文章数")
    total_embeddings: int = Field(..., description="Embedding 总数")


class RagReindexResponse(BaseModel):
    """重新索引响应"""

    success: bool = Field(..., description="是否成功")
    article_id: UUID = Field(..., description="文章 ID")
    message: str = Field(..., description="结果消息")
    task_id: Optional[str] = Field(default=None, description="Celery 任务 ID")


class EmbeddingItem(BaseModel):
    """单条 Embedding 信息"""

    id: UUID
    chunk_index: int
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ArticleEmbeddingsResponse(BaseModel):
    """文章 Embeddings 响应"""

    article_id: UUID
    embeddings: List[EmbeddingItem]
    count: int
