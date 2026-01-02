# Articles Embedding 实现指南

本文档详细描述 SaveHub 项目中文章向量嵌入（Embedding）的完整实现流程，供后续开发者参考和复用。

## 目录

1. [架构概述](#架构概述)
2. [数据流程图](#数据流程图)
3. [数据库设计](#数据库设计)
4. [核心模块](#核心模块)
5. [处理流程详解](#处理流程详解)
6. [向量检索](#向量检索)
7. [关键代码位置](#关键代码位置)
8. [复用指南](#复用指南)

---

## 架构概述

SaveHub 的 Embedding 系统是一个**多模态 RAG（Retrieval-Augmented Generation）管道**，核心特点：

- **多模态处理**：文本 + 图片（通过 Vision API 生成 caption）
- **语义分块**：使用 LangChain SemanticChunker 基于语义相似性分块
- **异步处理**：Celery 后台任务，不阻塞主流程
- **用户隔离**：所有数据通过 `user_id` 隔离，RLS 保护

### 技术栈

| 组件 | 技术 |
|------|------|
| 向量数据库 | Supabase PostgreSQL + pgvector |
| 向量维度 | 1536 维（OpenAI text-embedding-3-small 兼容） |
| 任务队列 | Celery + Redis |
| 语义分块 | LangChain SemanticChunker |
| Vision API | OpenAI 兼容接口（如 Qwen-VL） |

---

## 数据流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         文章 Embedding 处理流程                           │
└─────────────────────────────────────────────────────────────────────────┘

新文章入库
    │
    ▼
┌─────────────────┐
│  refresh_feed   │  ← Celery 任务：解析 RSS，保存文章
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ schedule_image_processing│  ← Celery Chord：并行处理图片
└────────┬────────────────┘
         │
         ▼ (并行)
┌─────────────────────────┐
│ process_article_images  │  × N 篇文章
└────────┬────────────────┘
         │
         ▼ (Chord 回调)
┌─────────────────────────┐
│   on_images_complete    │  ← 所有图片处理完成
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│schedule_rag_for_articles│  ← 调度 RAG 处理
└────────┬────────────────┘
         │
         ▼ (错开执行，每篇间隔 3s)
┌─────────────────────────┐
│  process_article_rag    │  × N 篇文章
│                         │
│  ┌───────────────────┐  │
│  │ 1. 获取文章内容    │  │
│  │ 2. 解析 HTML      │  │
│  │ 3. 生成图片 caption│  │
│  │ 4. 融合文本+caption│  │
│  │ 5. 语义分块       │  │
│  │ 6. 批量生成向量    │  │
│  │ 7. 存入数据库     │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

---

## 数据库设计

### all_embeddings 表

```sql
CREATE TABLE all_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL,           -- 关联文章
  user_id UUID NOT NULL,              -- 用户隔离
  chunk_index INT NOT NULL,           -- 块在文章中的顺序（0-based）
  content TEXT NOT NULL,              -- 文本内容（含图片描述）
  embedding VECTOR(1536) NOT NULL,    -- 1536 维向量
  metadata JSONB,                     -- 扩展信息
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT fk_article FOREIGN KEY (article_id)
    REFERENCES articles(id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);
```

### 索引设计

```sql
-- 按文章查询
CREATE INDEX idx_embeddings_article ON all_embeddings(article_id);

-- 按用户查询
CREATE INDEX idx_embeddings_user ON all_embeddings(user_id);

-- 联合查询
CREATE INDEX idx_embeddings_user_article ON all_embeddings(user_id, article_id);

-- pgvector 向量索引 (IVFFlat + 余弦距离)
CREATE INDEX idx_embeddings_vector
  ON all_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

### articles 表扩展字段

```sql
ALTER TABLE articles ADD COLUMN rag_processed BOOLEAN;
ALTER TABLE articles ADD COLUMN rag_processed_at TIMESTAMPTZ;

-- 部分索引：仅索引待处理的文章
CREATE INDEX idx_articles_rag_unprocessed
  ON articles (created_at DESC)
  WHERE rag_processed IS NULL AND images_processed = true;
```

### RLS 策略

```sql
-- 用户只能查看自己的 embeddings
CREATE POLICY "Users can view own embeddings"
  ON all_embeddings FOR SELECT
  USING (auth.uid() = user_id);

-- Service role 完全访问（后台任务）
CREATE POLICY "Service role full access"
  ON all_embeddings FOR ALL
  USING (auth.role() = 'service_role');
```

---

## 核心模块

### 模块结构

```
backend/app/
├── services/rag/
│   ├── chunker.py      # HTML 解析 + 语义分块
│   ├── vision.py       # 图片 caption 生成
│   ├── embedder.py     # 向量生成
│   └── retriever.py    # 向量检索
├── services/db/
│   └── rag.py          # 数据库操作
└── celery_app/
    └── rag_processor.py # Celery 任务
```

---

## 处理流程详解

### 1. HTML 解析与元素提取

**文件**: `backend/app/services/rag/chunker.py`

核心数据结构：

```python
@dataclass
class TextElement:
    """文本元素"""
    content: str

@dataclass
class ImageElement:
    """图片元素（占位符，待填充 caption）"""
    url: str
    caption: str = ""  # 待填充

@dataclass
class ParsedArticle:
    """解析后的文章，保持原始元素顺序"""
    title: str
    author: Optional[str]
    elements: List[ContentElement]  # TextElement | ImageElement
```

**关键函数**：

```python
def parse_article_content(
    title: str,
    author: Optional[str],
    html_content: str,
    base_url: Optional[str] = None,  # 用于解析相对 URL
) -> ParsedArticle:
    """
    解析文章 HTML，返回 ParsedArticle 对象。
    保持文本和图片的原始顺序。
    """
```

**URL 解析**：RSS 中的图片可能是相对路径，需要转换为绝对 URL：

```python
# 相对 URL 示例：
# /images/foo.png → https://example.com/images/foo.png
# images/foo.png → https://example.com/path/images/foo.png
# //cdn.example.com/foo.png → https://cdn.example.com/foo.png
```

---

### 2. 图片 Caption 生成

**文件**: `backend/app/services/rag/vision.py`

使用 Vision 模型（如 Qwen-VL）分析图片并生成中文描述：

```python
CAPTION_PROMPT = """你是一个专业的图片描述生成器。请仔细分析这张图片，用中文生成详细但简洁的描述。

要求：
1. 描述图片中的主要元素、场景和布局
2. 如果图片中有文字，请准确提取出来
3. 如果是图表或数据可视化，描述其类型和关键信息
4. 如果是代码截图，描述代码的语言和大致功能
5. 描述要信息完整但不超过200字
"""

def generate_image_caption(
    image_url: str,      # 必须是绝对 URL
    api_key: str,
    api_base: str,
    model: str,          # 如 qwen-vl-plus
) -> str:
    """直接传递图片 URL 给 Vision API"""
```

**安全版本**（失败返回 None）：

```python
def generate_image_caption_safe(...) -> Optional[str]:
    """失败时返回 None 而非抛出异常"""
```

---

### 3. 文本融合

图片 caption 替换到原位置，生成完整文本：

```python
def to_full_text(self) -> str:
    """
    将文章转换为完整文本。
    图片会被替换为其 caption，格式为 [图片描述: caption]。
    """
    parts = []
    parts.append(f"标题：{self.title}")
    if self.author:
        parts.append(f"作者：{self.author}")

    for element in self.elements:
        if isinstance(element, TextElement):
            parts.append(element.content.strip())
        elif isinstance(element, ImageElement):
            if element.caption:
                parts.append(f"[图片描述: {element.caption}]")

    return "\n\n".join(parts)
```

**输出示例**：

```
标题：深度学习入门指南

作者：张三

深度学习是机器学习的一个分支...

[图片描述: 一张神经网络结构图，展示了输入层、三个隐藏层和输出层的连接关系]

卷积神经网络（CNN）主要用于图像处理...
```

---

### 4. 语义分块

**文件**: `backend/app/services/rag/chunker.py`

使用 LangChain SemanticChunker 基于语义相似性分块：

```python
def chunk_text_semantic(
    text: str,
    api_key: str,
    api_base: str,
    model: str,
) -> List[str]:
    """
    语义分块原理：
    1. 将文本分割成句子
    2. 计算相邻句子之间的嵌入相似度
    3. 当相似度低于阈值时断开形成新块
    """
    from langchain_experimental.text_splitter import SemanticChunker
    from langchain_openai import OpenAIEmbeddings

    embeddings = OpenAIEmbeddings(
        api_key=api_key,
        base_url=api_base,
        model=model,
    )

    chunker = SemanticChunker(
        embeddings,
        breakpoint_threshold_type="percentile",  # 百分位数阈值
    )

    docs = chunker.create_documents([text])
    return [doc.page_content for doc in docs]
```

**降级策略**（语义分块失败时）：

```python
def fallback_chunk_text(
    text: str,
    max_chars: int = 1000,
    overlap: int = 100
) -> List[str]:
    """按字符数切分，尝试在句子边界断开"""
```

---

### 5. 向量生成

**文件**: `backend/app/services/rag/embedder.py`

```python
# 网络配置
DEFAULT_TIMEOUT = httpx.Timeout(60.0, connect=30.0)
DEFAULT_MAX_RETRIES = 3
DEFAULT_BATCH_SIZE = 100

def embed_texts(
    texts: List[str],
    api_key: str,
    api_base: str,
    model: str,
    batch_size: int = 100,
) -> List[List[float]]:
    """
    批量生成 embeddings，返回 1536 维向量列表。
    - 自动过滤空文本
    - 分批处理减少 API 调用
    - 保持原始顺序
    """
    client = OpenAI(
        api_key=api_key,
        base_url=_normalize_base_url(api_base),
        timeout=DEFAULT_TIMEOUT,
        max_retries=DEFAULT_MAX_RETRIES,
    )

    response = client.embeddings.create(
        model=model,
        input=texts,
        dimensions=1536
    )
    return [emb.embedding for emb in response.data]
```

**URL 规范化**（处理用户配置错误）：

```python
def _normalize_base_url(url: str) -> str:
    """
    移除用户可能误加的路径后缀：
    - xxx/v1/embeddings -> xxx/v1
    - xxx/v1/chat/completions -> xxx/v1
    """
```

---

### 6. Celery 任务编排

**文件**: `backend/app/celery_app/rag_processor.py`

核心任务配置：

```python
@app.task(
    bind=True,
    name="process_article_rag",
    max_retries=2,
    default_retry_delay=60,
    time_limit=300,       # 硬超时 5 分钟
    soft_time_limit=270,  # 软超时 4.5 分钟
)
def process_article_rag(self, article_id: str, user_id: str):
    """处理单篇文章的 RAG"""
```

**定时扫描任务**（每 30 分钟）：

```python
@app.task(name="scan_pending_rag_articles")
def scan_pending_rag_articles():
    """扫描待处理文章，调度 RAG 任务"""
    articles = get_pending_articles(limit=50)
    for i, article in enumerate(articles):
        process_article_rag.apply_async(
            kwargs={"article_id": article["id"], "user_id": article["user_id"]},
            countdown=i * 5,  # 每篇间隔 5 秒，避免 API 限流
        )
```

---

## 向量检索

**文件**: `backend/app/services/rag/retriever.py`

### RPC 函数（Supabase SQL）

```sql
CREATE OR REPLACE FUNCTION search_all_embeddings(
    query_embedding vector(1536),
    match_user_id uuid,
    match_count int DEFAULT 10,
    match_feed_id uuid DEFAULT NULL,
    min_similarity float DEFAULT 0.0
)
RETURNS TABLE (
    id uuid,
    article_id uuid,
    chunk_index int,
    content text,
    score float,
    article_title text,
    article_url text
)
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id, e.article_id, e.chunk_index, e.content,
        1 - (e.embedding <=> query_embedding) AS score,  -- 余弦相似度
        a.title, a.url
    FROM all_embeddings e
    JOIN articles a ON e.article_id = a.id
    WHERE e.user_id = match_user_id
      AND (match_feed_id IS NULL OR a.feed_id = match_feed_id)
      AND 1 - (e.embedding <=> query_embedding) >= min_similarity
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

### Python 调用

```python
def search_embeddings(
    supabase: Client,
    query_embedding: List[float],
    user_id: str,
    top_k: int = 10,
    feed_id: Optional[str] = None,
    min_score: float = 0.0,
) -> List[Dict[str, Any]]:
    """向量相似度搜索"""
    result = supabase.rpc(
        "search_all_embeddings",
        {
            "query_embedding": query_embedding,
            "match_user_id": user_id,
            "match_count": top_k,
            "match_feed_id": feed_id,
            "min_similarity": min_score,
        }
    ).execute()
    return result.data or []
```

---

## 关键代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| HTML 解析入口 | `backend/app/services/rag/chunker.py` | 227-261 |
| 图片 caption 生成 | `backend/app/services/rag/vision.py` | 61-122 |
| 语义分块 | `backend/app/services/rag/chunker.py` | 268-325 |
| 向量生成 | `backend/app/services/rag/embedder.py` | 117-203 |
| RAG 处理主流程 | `backend/app/celery_app/rag_processor.py` | 108-285 |
| 数据库存储 | `backend/app/services/db/rag.py` | 27-87 |
| 向量检索 | `backend/app/services/rag/retriever.py` | 15-77 |
| 表结构定义 | `backend/scripts/020_create_article_embeddings.sql` | 全文件 |

---

## 复用指南

### 场景 1：为其他内容生成 Embedding

```python
from app.services.rag.embedder import embed_texts

# 准备文本
texts = ["文本1", "文本2", "文本3"]

# 批量生成向量
embeddings = embed_texts(
    texts=texts,
    api_key="your-api-key",
    api_base="https://api.openai.com/v1",
    model="text-embedding-3-small",
)

# embeddings[i] 对应 texts[i] 的 1536 维向量
```

### 场景 2：复用 HTML 解析逻辑

```python
from app.services.rag.chunker import parse_article_content

# 解析 HTML
parsed = parse_article_content(
    title="文章标题",
    author="作者",
    html_content="<p>内容...</p><img src='/img.png'>",
    base_url="https://example.com/article/123",  # 用于解析相对 URL
)

# 获取图片 URL
image_urls = parsed.get_image_urls()

# 填充 caption 后生成完整文本
parsed.fill_captions({"https://example.com/img.png": "图片描述"})
full_text = parsed.to_full_text()
```

### 场景 3：复用语义分块

```python
from app.services.rag.chunker import chunk_text_semantic, fallback_chunk_text

# 语义分块（需要 Embedding API）
chunks = chunk_text_semantic(
    text="长文本内容...",
    api_key="your-api-key",
    api_base="https://api.openai.com/v1",
    model="text-embedding-3-small",
)

# 或使用简单分块（无需 API）
chunks = fallback_chunk_text(text="长文本内容...", max_chars=1000)
```

---

## 注意事项

### 1. API 配置

用户需要在前端配置两种 API：
- **Chat API**：用于图片 caption 生成（需支持 Vision）
- **Embedding API**：用于向量生成

配置存储在 `api_configs` 表，API Key 加密存储。

### 2. 向量维度

当前固定使用 **1536 维**（OpenAI text-embedding-3-small 兼容）。如需更换模型：
1. 修改 `embedder.py` 中的 `dimensions` 参数
2. 更新数据库表的 `VECTOR(1536)` 定义
3. 重建向量索引

### 3. 错误处理

- 单篇文章处理失败不影响其他文章
- 语义分块失败自动降级到简单分块
- 图片 caption 生成失败跳过该图片
- 所有错误记录到日志，文章标记为 `rag_processed=false`

### 4. 依赖包

```txt
# requirements.txt
openai>=1.0.0
langchain-experimental
langchain-openai
beautifulsoup4
httpx
```

---

## 相关文档

- `docs/ai_feature/embedding-api.md` - Embedding API 配置说明
- `docs/semantic-search-guide.md` - 语义搜索使用指南
- `backend/app/services/rag/CLAUDE.md` - RAG 模块内部文档
- `backend/app/celery_app/CLAUDE.md` - Celery 任务链说明
