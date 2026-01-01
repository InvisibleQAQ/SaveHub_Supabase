"""
文章内容解析和语义分块。

使用 langchain SemanticChunker 进行基于语义相似性的文本分块。
图片 caption 会替换原来图片的位置，然后和文本一起进行分块。
"""

import logging
import re
from dataclasses import dataclass, field
from typing import List, Literal, Optional, Union
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, NavigableString

logger = logging.getLogger(__name__)


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class TextElement:
    """文本元素"""
    content: str


@dataclass
class ImageElement:
    """图片元素（占位符，待填充 caption）"""
    url: str
    caption: str = ""  # 待填充


# 元素类型
ContentElement = Union[TextElement, ImageElement]


@dataclass
class ParsedArticle:
    """
    解析后的文章，保持原始元素顺序。

    elements 列表按照原文顺序排列，包含：
    - TextElement: 文本段落
    - ImageElement: 图片（待填充 caption）
    """
    title: str
    author: Optional[str]
    elements: List[ContentElement] = field(default_factory=list)

    def get_image_urls(self) -> List[str]:
        """获取所有图片 URL"""
        return [e.url for e in self.elements if isinstance(e, ImageElement)]

    def fill_captions(self, captions: dict[str, str]) -> None:
        """
        填充图片 caption。

        Args:
            captions: {url: caption} 映射
        """
        for element in self.elements:
            if isinstance(element, ImageElement) and element.url in captions:
                element.caption = captions[element.url]

    def to_full_text(self) -> str:
        """
        将文章转换为完整文本。

        图片会被替换为其 caption（如果有），格式为 [图片描述: caption]。
        """
        parts = []

        # 添加标题和作者
        parts.append(f"标题：{self.title}")
        if self.author:
            parts.append(f"作者：{self.author}")
        parts.append("")  # 空行分隔

        # 按顺序添加内容元素
        for element in self.elements:
            if isinstance(element, TextElement):
                if element.content.strip():
                    parts.append(element.content.strip())
            elif isinstance(element, ImageElement):
                if element.caption:
                    # 将图片 caption 以特定格式插入
                    parts.append(f"[图片描述: {element.caption}]")

        return "\n\n".join(parts)


# =============================================================================
# HTML Parsing
# =============================================================================

def clean_text(text: str) -> str:
    """清理文本：去除多余空白、合并连续换行"""
    if not text:
        return ""

    # 替换多个连续空白为单个空格
    text = re.sub(r"[ \t]+", " ", text)
    # 替换多个连续换行为两个换行
    text = re.sub(r"\n{3,}", "\n\n", text)
    # 去除首尾空白
    text = text.strip()

    return text


def _is_absolute_url(url: str) -> bool:
    """检查 URL 是否为绝对路径"""
    parsed = urlparse(url)
    return bool(parsed.scheme and parsed.netloc)


def _resolve_url(src: str, base_url: Optional[str]) -> str:
    """
    将相对 URL 转换为绝对 URL。

    Args:
        src: 图片 src 属性值
        base_url: 文章原始 URL（用于解析相对路径）

    Returns:
        绝对 URL，如果无法解析则返回原始 src
    """
    if not src:
        return src

    # 已经是绝对 URL
    if _is_absolute_url(src):
        return src

    # 协议相对 URL (//example.com/image.png)
    if src.startswith("//"):
        return f"https:{src}"

    # 需要 base_url 来解析相对路径
    if not base_url:
        logger.warning(f"Cannot resolve relative URL without base_url: {src[:100]}")
        return src

    # 使用 urljoin 解析相对路径
    resolved = urljoin(base_url, src)
    logger.debug(f"Resolved URL: {src[:50]} -> {resolved[:50]}")
    return resolved


def parse_html_to_elements(
    html_content: str,
    base_url: Optional[str] = None,
) -> List[ContentElement]:
    """
    解析 HTML 内容，按顺序提取文本和图片元素。

    保持原文中文本和图片的相对顺序。

    Args:
        html_content: HTML 内容字符串
        base_url: 文章原始 URL，用于解析相对路径的图片 URL

    Returns:
        ContentElement 列表，按原文顺序排列
    """
    if not html_content:
        return []

    soup = BeautifulSoup(html_content, "html.parser")

    # 移除 script 和 style 标签
    for tag in soup.find_all(["script", "style", "noscript"]):
        tag.decompose()

    elements: List[ContentElement] = []
    current_text_parts: List[str] = []

    def flush_text():
        """将当前积累的文本作为一个 TextElement 添加"""
        nonlocal current_text_parts
        if current_text_parts:
            combined = clean_text(" ".join(current_text_parts))
            if combined:
                elements.append(TextElement(content=combined))
            current_text_parts = []

    def process_element(element):
        """递归处理 HTML 元素"""
        if isinstance(element, NavigableString):
            text = str(element).strip()
            if text:
                current_text_parts.append(text)
            return

        # 处理图片 - 关键：保持图片在原文中的位置
        if element.name == "img":
            src = element.get("src", "")
            if src and not src.startswith("data:"):
                # 先保存当前积累的文本
                flush_text()
                # 解析相对 URL 为绝对 URL
                resolved_url = _resolve_url(src, base_url)
                # 添加图片元素
                elements.append(ImageElement(url=resolved_url))
            return

        # 递归处理子元素
        for child in element.children:
            process_element(child)

        # 块级元素后添加分隔
        if element.name in {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
                            "ul", "ol", "blockquote", "section", "article"}:
            flush_text()

    process_element(soup)

    # 处理剩余文本
    flush_text()

    return elements


def parse_article_content(
    title: str,
    author: Optional[str],
    html_content: str,
    base_url: Optional[str] = None,
) -> ParsedArticle:
    """
    解析文章内容，返回 ParsedArticle 对象。

    ParsedArticle 保持原文中文本和图片的顺序，图片可以稍后填充 caption。

    Args:
        title: 文章标题
        author: 文章作者（可选）
        html_content: HTML 内容
        base_url: 文章原始 URL，用于解析相对路径的图片 URL

    Returns:
        ParsedArticle 对象
    """
    elements = parse_html_to_elements(html_content, base_url)

    image_count = sum(1 for e in elements if isinstance(e, ImageElement))
    text_count = sum(1 for e in elements if isinstance(e, TextElement))

    logger.debug(
        f"Parsed article '{title[:30]}...': "
        f"text_blocks={text_count}, images={image_count}"
    )

    return ParsedArticle(
        title=title,
        author=author,
        elements=elements,
    )


# =============================================================================
# Text Chunking
# =============================================================================

def chunk_text_semantic(
    text: str,
    api_key: str,
    api_base: str,
    model: str,
) -> List[str]:
    """
    使用 langchain SemanticChunker 进行语义分块。

    语义分块原理：
    1. 将文本分割成句子
    2. 计算相邻句子之间的嵌入相似度
    3. 当相似度低于阈值时断开形成新块

    Args:
        text: 待分块的文本
        api_key: Embedding API Key
        api_base: Embedding API Base URL
        model: Embedding 模型名称

    Returns:
        分块后的文本列表
    """
    if not text or not text.strip():
        return []

    try:
        from langchain_experimental.text_splitter import SemanticChunker
        from langchain_openai import OpenAIEmbeddings

        # 创建 embeddings 实例
        embeddings = OpenAIEmbeddings(
            api_key=api_key,
            base_url=api_base,
            model=model,
        )

        # 创建语义分块器
        chunker = SemanticChunker(
            embeddings,
            breakpoint_threshold_type="percentile",  # 使用百分位数阈值
        )

        # 执行分块
        docs = chunker.create_documents([text])
        chunks = [doc.page_content for doc in docs if doc.page_content.strip()]

        logger.info(f"Semantic chunking: input_len={len(text)}, output_chunks={len(chunks)}")

        return chunks

    except ImportError as e:
        logger.error(f"langchain dependencies not installed: {e}")
        raise RuntimeError("请安装 langchain-experimental 和 langchain-openai") from e
    except Exception as e:
        logger.error(f"Semantic chunking failed: {e}")
        # 降级到简单分块
        return fallback_chunk_text(text)


def fallback_chunk_text(text: str, max_chars: int = 1000, overlap: int = 100) -> List[str]:
    """
    降级的简单分块策略：按字符数切分。

    当语义分块失败时使用此方法。

    Args:
        text: 待分块的文本
        max_chars: 每块最大字符数
        overlap: 块之间的重叠字符数

    Returns:
        分块后的文本列表
    """
    if not text:
        return []

    if len(text) <= max_chars:
        return [text]

    chunks = []
    start = 0
    step = max_chars - overlap

    while start < len(text):
        end = start + max_chars
        chunk = text[start:end]

        # 尝试在句子边界断开
        if end < len(text):
            # 寻找最后一个句号、问号或感叹号
            for sep in ["。", "！", "？", ".", "!", "?"]:
                last_sep = chunk.rfind(sep)
                if last_sep > max_chars // 2:  # 至少保留一半
                    chunk = chunk[: last_sep + 1]
                    end = start + last_sep + 1
                    break

        if chunk.strip():
            chunks.append(chunk.strip())

        start = max(start + step, end - overlap)

    logger.info(f"Fallback chunking: input_len={len(text)}, output_chunks={len(chunks)}")

    return chunks
