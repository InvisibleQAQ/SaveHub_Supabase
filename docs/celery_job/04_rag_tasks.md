# RAG 处理任务

## 概述

RAG（Retrieval-Augmented Generation）处理任务负责为文章生成向量嵌入，支持语义搜索和 AI 问答。

**文件位置**: `backend/app/celery_app/rag_processor.py`

## 任务列表

| 任务名 | 行号 | 触发方式 | 功能 |
|--------|------|----------|------|
| `process_article_rag` | 287-338 | 任务链 | 处理单篇文章的 RAG |
| `scan_pending_rag_articles` | 341-348 | Beat 每30分钟 | 扫描遗漏的文章 |
| `on_images_complete` | 回调 | Chord | 单 Feed 图像完成后触发 |
| `schedule_rag_for_articles` | 内部 | 调度 | 批量调度 RAG 处理 |

## 处理流程

```
process_article_rag(article_id, user_id)
    │
    ├─ 1. 获取文章内容
    │
    ├─ 2. 获取用户 API 配置（Chat + Embedding）
    │
    ├─ 3. 解析 HTML，提取文本和图片
    │
    ├─ 4. 为图片生成 caption（Vision API）
    │
    ├─ 5. 将 caption 替换到图片原位置
    │
    ├─ 6. 对完整文本进行语义分块
    │
    ├─ 7. 批量生成 embeddings
    │
    ├─ 8. 存入 all_embeddings 表（pgvector）
    │
    ├─ 9. 标记 rag_processed = true
    │
    └─ 10. 触发仓库提取 (extract_article_repos)
```

## process_article_rag 任务

**位置**: `rag_processor.py:287-338`

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
```

### 返回值

```python
# 成功
{"success": True, "article_id": "...", "chunks": 5, "images": 2}

# 已处理（跳过）
{"success": True, "article_id": "...", "chunks": 0, "images": 0, "skipped": True}

# 失败
{"success": False, "article_id": "...", "error": "..."}
```

## 任务链触发

RAG 处理完成后自动触发仓库提取：

```python
# rag_processor.py:319-326
if result.get("success"):
    extract_article_repos.apply_async(
        kwargs={"article_id": article_id, "user_id": user_id},
        countdown=STAGGER_DELAY_TRIGGER,  # 1秒延迟
        queue="default",
    )
```

## Beat 容错任务

**位置**: `rag_processor.py:341-348`

每 30 分钟扫描遗漏的文章：

```python
@app.task(name="scan_pending_rag_articles")
def scan_pending_rag_articles():
    """
    条件：images_processed = true AND rag_processed IS NULL
    """
```

## 依赖的服务

| 服务 | 用途 |
|------|------|
| `ChatClient` | Vision API 生成图片 caption |
| `EmbeddingClient` | 生成文本向量 |
| `chunker.py` | 语义分块 |
| `RagService` | 存储 embeddings |
