# SaveHub 语义搜索实现指南

> 参考 minne 项目，为 SaveHub 实现基于 pgvector 的语义搜索功能

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         数据流程                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  RSS 刷新 → 文章保存 → Celery 任务 → 分块 → Embedding → 存储         │
│                                                                     │
│  用户查询 → Embedding → 向量搜索 → 聚合 → 返回结果                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         表结构                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  articles (现有)              article_chunks (新增)                  │
│  ┌──────────────────┐        ┌──────────────────────┐               │
│  │ id               │───────>│ article_id           │               │
│  │ title            │        │ chunk_index          │               │
│  │ summary          │        │ content              │               │
│  │ content          │        │ embedding (3072)     │               │
│  │ embedding_status │        │ user_id              │               │
│  └──────────────────┘        └──────────────────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 参考: Minne 项目设计

### 2.1 核心架构

Minne 采用三层混合检索：
- **向量搜索 (50%)**：语义相似度
- **全文搜索 (30%)**：BM25 关键词匹配
- **图遍历 (20%)**：关系发现

本项目 **Phase 1 简化为纯向量搜索**，后续可扩展。

### 2.2 Minne 关键设计

| 组件 | Minne 实现 | SaveHub 适配 |
|------|-----------|--------------|
| 数据库 | SurrealDB | PostgreSQL + pgvector |
| Embedding | OpenAI text-embedding-3-small (1536) | text-embedding-3-large (3072) |
| 分块 | TextChunk 表，500-2000 字符 | article_chunks 表，相同策略 |
| 索引类型 | HNSW | HNSW (`vector_cosine_ops`) |
| 距离度量 | 欧几里得/余弦（未明确） | 余弦距离 `<=>` |
| 搜索算法 | KNN (近似最近邻) | KNN (近似最近邻) |
| 分数融合 | 加权平均 + 多信号奖励 | Phase 2 实现 |

> **注**：对于 OpenAI 归一化向量，余弦距离和欧几里得距离排序结果相同。
> 选择余弦距离是因为 `1 - distance` 直接得到 0-1 相似度，语义更直观。

### 2.3 Minne 关键代码路径

| 功能 | Minne 位置 |
|------|-----------|
| Embedding 生成 | `common/src/utils/embedding.rs` |
| 向量搜索 | `composite-retrieval/src/vector.rs` |
| 全文搜索 | `composite-retrieval/src/fts.rs` |
| 分数融合 | `composite-retrieval/src/scoring.rs` |
| 检索管道 | `composite-retrieval/src/pipeline/mod.rs` |

---

## 3. 数据库设计

### 3.1 article_chunks 表

```sql
CREATE TABLE IF NOT EXISTS article_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,           -- 块在文章中的顺序（0开始）
  content text NOT NULL,              -- 块文本内容
  embedding vector(3072),             -- text-embedding-3-large
  created_at timestamptz DEFAULT now(),
  UNIQUE(article_id, chunk_index)
);
```

### 3.2 articles 表扩展

```sql
ALTER TABLE articles ADD COLUMN IF NOT EXISTS
  embedding_status text CHECK (embedding_status IN ('pending', 'processing', 'completed', 'failed')),
  embedding_error text,
  embedding_updated_at timestamptz;
```

**状态机**:
```
NULL/pending → processing → completed
                    ↓
                  failed
```

### 3.3 api_configs 表扩展

```sql
-- 添加 embedding 专用配置字段（用户必填，无默认值）
ALTER TABLE api_configs ADD COLUMN IF NOT EXISTS embedding_api_key text;
ALTER TABLE api_configs ADD COLUMN IF NOT EXISTS embedding_api_base text;
ALTER TABLE api_configs ADD COLUMN IF NOT EXISTS embedding_model text;
```

**字段说明**：
| 字段 | 必填 | 说明 |
|------|------|------|
| `embedding_api_key` | ✅ | Embedding API 密钥 |
| `embedding_api_base` | ✅ | Embedding API 地址（如 `https://api.openai.com/v1`） |
| `embedding_model` | ✅ | Embedding 模型名称（如 `text-embedding-3-large`） |

> **注意**：这三个字段独立于 chat 模型配置，用户需在设置中单独配置。若未配置，语义搜索功能不可用。

### 3.4 索引设计

```sql
-- HNSW 向量索引（余弦距离）
CREATE INDEX IF NOT EXISTS idx_article_chunks_embedding
  ON article_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- 辅助索引
CREATE INDEX IF NOT EXISTS idx_article_chunks_article_id ON article_chunks(article_id);
CREATE INDEX IF NOT EXISTS idx_article_chunks_user_id ON article_chunks(user_id);

-- 待处理文章索引
CREATE INDEX IF NOT EXISTS idx_articles_pending_embedding
  ON articles(user_id, created_at DESC)
  WHERE embedding_status IS NULL OR embedding_status = 'pending';
```

### 3.5 向量搜索函数

```sql
CREATE OR REPLACE FUNCTION vector_search_articles(
  query_embedding vector(3072),
  p_user_id uuid,
  match_count int DEFAULT 10,
  match_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  article_id uuid,
  chunk_id uuid,
  chunk_content text,
  chunk_index int,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.article_id,
    c.id as chunk_id,
    c.content as chunk_content,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) as similarity
  FROM article_chunks c
  WHERE c.user_id = p_user_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

**关键点**:
- `<=>` 是 pgvector 的余弦距离操作符
- `1 - distance` 转换为相似度（0-1）
- HNSW 索引自动加速查询

---

## 4. 分块策略

### 4.1 分块参数

| 参数 | 值 | 说明 |
|------|-----|------|
| MIN_CHUNK_SIZE | 500 | 最小块大小 |
| MAX_CHUNK_SIZE | 2000 | 最大块大小 |
| OVERLAP | 100 | 块之间重叠（可选） |

### 4.2 分块算法

```python
def chunk_article(article: dict) -> List[str]:
    """
    1. 拼接内容: title + "\n\n" + summary + "\n\n" + content
    2. 按段落/句号边界分割
    3. 合并小块，确保每块 >= MIN_CHUNK_SIZE
    4. 拆分大块，确保每块 <= MAX_CHUNK_SIZE
    """
```

### 4.3 分块边界优先级

1. 双换行（段落边界）
2. 句号 + 空格
3. 逗号 + 空格
4. 强制截断（最后手段）

---

## 5. Embedding 服务

### 5.1 API 配置获取

```python
from app.services.db.api_configs import ApiConfigService

# 获取用户默认 API 配置
api_config_service = ApiConfigService(supabase, user_id)
config = api_config_service.get_default_config()

# Embedding 配置从 api_configs 表的专用字段读取:
# {
#   "embedding_api_key": "sk-...",      # 必填
#   "embedding_api_base": "https://api.openai.com/v1",  # 必填
#   "embedding_model": "text-embedding-3-large"         # 必填
# }

# 检查 embedding 配置是否完整
if not all([config.get("embedding_api_key"),
            config.get("embedding_api_base"),
            config.get("embedding_model")]):
    raise ValueError("Embedding configuration not set. Please configure embedding_api_key, embedding_api_base, and embedding_model in settings.")
```

### 5.2 OpenAI 调用

```python
from openai import OpenAI

client = OpenAI(
    api_key=config["embedding_api_key"],
    base_url=config["embedding_api_base"]
)

response = client.embeddings.create(
    input="文本内容",
    model=config["embedding_model"]
)

embedding = response.data[0].embedding  # List[float]
```

### 5.3 批量处理

```python
def batch_embed(texts: List[str], config: dict, batch_size: int = 100) -> List[List[float]]:
    """
    OpenAI 单次最多支持 2048 个 input
    建议 batch_size=100 以平衡速度和内存
    """
    client = OpenAI(
        api_key=config["embedding_api_key"],
        base_url=config["embedding_api_base"]
    )
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        response = client.embeddings.create(
            input=batch,
            model=config["embedding_model"]
        )
        all_embeddings.extend([d.embedding for d in response.data])
    return all_embeddings
```

---

## 6. 搜索服务

### 6.1 搜索流程

```
用户查询 "机器学习相关的新闻"
    │
    ▼
生成查询 Embedding (3072 维)
    │
    ▼
调用 vector_search_articles RPC
    │
    ▼
返回 chunk 级别结果:
  [(article_id=A, chunk_id=1, similarity=0.85),
   (article_id=A, chunk_id=2, similarity=0.75),
   (article_id=B, chunk_id=1, similarity=0.70)]
    │
    ▼
按 article_id 聚合，取最高分:
  [A: 0.85, B: 0.70]
    │
    ▼
关联文章详情，返回结果
```

### 6.2 结果聚合

```python
def aggregate_results(chunk_results: List[dict]) -> List[SearchResult]:
    """
    1. 按 article_id 分组
    2. 每篇文章取最高 chunk 分数作为文章分数
    3. 保留匹配的 chunk 内容用于高亮显示
    """
    article_map = {}
    for row in chunk_results:
        aid = row["article_id"]
        if aid not in article_map:
            article_map[aid] = {
                "article_id": aid,
                "score": row["similarity"],
                "matched_chunks": []
            }
        article_map[aid]["matched_chunks"].append({
            "chunk_index": row["chunk_index"],
            "content": row["chunk_content"],
            "score": row["similarity"]
        })
        # 更新最高分
        if row["similarity"] > article_map[aid]["score"]:
            article_map[aid]["score"] = row["similarity"]

    # 按分数排序
    results = list(article_map.values())
    results.sort(key=lambda x: x["score"], reverse=True)
    return results
```

---

## 7. Celery 任务设计

### 7.1 任务定义

```python
@app.task(
    name="generate_article_embedding",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    retry_backoff=True,
    time_limit=60,
    soft_time_limit=45,
)
def generate_article_embedding(self, article_id: str, user_id: str):
    """单篇文章 embedding 生成"""
    pass
```

### 7.2 错误处理

```python
try:
    # embedding 生成逻辑
except Exception as e:
    # 更新失败状态
    supabase.table("articles").update({
        "embedding_status": "failed",
        "embedding_error": str(e)[:500]
    }).eq("id", article_id).execute()

    # 重试
    raise self.retry(exc=e)
```

### 7.3 RSS 刷新集成

在 `tasks.py` 的 `do_refresh_feed` 函数中：

```python
# 保存文章后
response = supabase.table("articles").upsert(db_articles).execute()

# 触发 embedding 生成
if response.data:
    new_ids = [a["id"] for a in response.data]
    trigger_embedding_on_article_save.apply_async(
        kwargs={"article_ids": new_ids, "user_id": user_id},
        countdown=5  # 延迟 5 秒确保事务提交
    )
```

---

## 8. API 设计

### 8.1 请求

```json
POST /api/search/articles
Content-Type: application/json
Authorization: Bearer <token>

{
  "query": "机器学习相关的新闻",
  "top_k": 10
}
```

### 8.2 响应

```json
{
  "results": [
    {
      "article_id": "uuid-1",
      "title": "GPT-5 发布在即",
      "summary": "OpenAI 宣布...",
      "url": "https://example.com/article1",
      "published_at": "2024-01-15T10:00:00Z",
      "score": 0.85,
      "matched_chunks": [
        {
          "chunk_index": 0,
          "content": "OpenAI 今日宣布其最新的机器学习模型...",
          "score": 0.85
        }
      ]
    }
  ],
  "total": 5,
  "query": "机器学习相关的新闻"
}
```

### 8.3 错误响应

```json
{
  "detail": "No default API config found for embedding"
}
```

---

## 9. 后续扩展

### Phase 2: 混合搜索

添加 BM25 全文索引：

```sql
ALTER TABLE article_chunks ADD COLUMN IF NOT EXISTS fts_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_article_chunks_fts ON article_chunks USING gin(fts_vector);
```

分数融合公式（参考 minne）：

```python
fused_score = (
    vector_weight * vector_score +
    fts_weight * fts_score
)

# 默认权重
vector_weight = 0.7
fts_weight = 0.3

# 多信号奖励
if both_vector_and_fts_hit:
    fused_score += 0.02
```

### Phase 3: 重排序

使用 Cross-Encoder 对 top-K 结果精排：

```python
# 使用 jina-reranker 或 cohere-rerank
final_score = 0.35 * original_score + 0.65 * rerank_score
```

---

## 10. 关键文件路径

| 文件 | 功能 |
|------|------|
| `backend/scripts/016_add_article_chunks.sql` | 数据库迁移 |
| `backend/scripts/017_vector_search_function.sql` | 搜索函数 |
| `backend/app/services/chunking.py` | 文本分块 |
| `backend/app/services/embedding.py` | Embedding 生成 |
| `backend/app/services/search.py` | 搜索服务 |
| `backend/app/schemas/search.py` | Pydantic Schema |
| `backend/app/api/routers/search.py` | API 端点 |
| `backend/app/celery_app/embedding_tasks.py` | Celery 任务 |
| `backend/app/services/db/api_configs.py:126` | API 配置获取 |
| `backend/app/celery_app/tasks.py` | RSS 刷新任务 |
