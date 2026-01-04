"""
RAG (Retrieval-Augmented Generation) 服务模块。

提供 RAG 功能：
- chunker: HTML 内容解析和语义分块
- retriever: pgvector 向量检索

注意：embedding 和 vision 功能已迁移到 app.services.ai 模块。
"""

from .chunker import (
    ParsedArticle,
    TextElement,
    ImageElement,
    parse_article_content,
    chunk_text_semantic,
    fallback_chunk_text,
)
from .retriever import search_embeddings

__all__ = [
    "ParsedArticle",
    "TextElement",
    "ImageElement",
    "parse_article_content",
    "chunk_text_semantic",
    "fallback_chunk_text",
    "search_embeddings",
]
