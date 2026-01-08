# 图像处理任务

## 概述

图像处理任务负责下载文章中的外部图片，压缩后上传到 Supabase Storage，并替换文章内容中的图片 URL。

**文件位置**: `backend/app/celery_app/image_processor.py`

## 任务列表

| 任务名 | 行号 | 触发方式 | 功能 |
|--------|------|----------|------|
| `process_article_images` | 326-388 | Chord/直接 | 处理单篇文章的图片 |
| `schedule_image_processing` | 395-441 | 任务链 | 单 Feed 图像调度（Chord） |
| `schedule_batch_image_processing` | 448-497 | 任务链 | 批量图像调度（Chord） |
| `on_batch_images_complete` | 500-537 | Chord 回调 | 批量完成后触发 RAG |
| `scan_pending_image_articles` | 552-600 | Beat 每30分钟 | 容错：扫描遗漏的图像处理 |

## 处理流程

```
process_article_images(article_id)
    │
    ├─ 1. 获取文章内容
    │
    ├─ 2. 解析 HTML，提取所有 <img> 标签
    │
    ├─ 3. 对每张图片：
    │      ├─ 下载图片（SSRF 防护）
    │      ├─ 压缩为 WebP 格式
    │      ├─ 上传到 Supabase Storage
    │      └─ 替换 HTML 中的 src
    │
    ├─ 4. 更新文章内容
    │
    └─ 5. 标记 images_processed = true
```

## process_article_images 任务

**位置**: `image_processor.py:326-388`

```python
@app.task(
    bind=True,
    name="process_article_images",
    max_retries=2,
    default_retry_delay=30,
    time_limit=180,       # 硬超时 3 分钟
    soft_time_limit=150,  # 软超时 2.5 分钟
)
def process_article_images(self, article_id: str):
```

### 返回值

```python
# 成功
{"success": True, "article_id": "...", "processed": 3, "total": 5}

# 已处理（跳过）
{"success": True, "article_id": "...", "processed": 0, "total": 0, "skipped": True}

# 失败
{"success": False, "article_id": "...", "error": "..."}
```

## Chord 调度模式

### 单 Feed 模式

**位置**: `image_processor.py:395-441`

```python
schedule_image_processing(article_ids, feed_id)
    │
    ├─ 创建 Chord
    │      Header: [process_article_images x N]
    │      Callback: on_images_complete(article_ids, feed_id)
    │
    └─ 所有图片处理完成后 → 触发 RAG 处理
```

### 批量模式

**位置**: `image_processor.py:448-497`

```python
schedule_batch_image_processing(article_ids, user_id)
    │
    ├─ 创建 Chord
    │      Header: [process_article_images x N]
    │      Callback: on_batch_images_complete(article_ids, user_id)
    │
    └─ 所有图片处理完成后 → 触发 RAG 处理
```

## 安全措施

### SSRF 防护

**位置**: `image_processor.py:57-64`

```python
def is_private_ip(hostname: str) -> bool:
    """检查是否为私有 IP（防止 SSRF 攻击）"""
    ip = socket.gethostbyname(hostname)
    ip_obj = ipaddress.ip_address(ip)
    return ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved
```

### 内容类型验证

```python
ALLOWED_CONTENT_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/svg+xml", "image/avif", "image/bmp",
}
```

### 大小限制

```python
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
DOWNLOAD_TIMEOUT = 15  # 秒
```

## 存储位置

图片上传到 Supabase Storage 的 `article-images` bucket：

```
article-images/
└── {user_id}/
    └── {article_id}/
        └── {hash}.{ext}
```

## Beat 容错任务

**位置**: `image_processor.py:552-600`

每 30 分钟扫描遗漏的文章（第一环断裂的容错）：

```python
@app.task(name="scan_pending_image_articles")
def scan_pending_image_articles():
    """
    条件：images_processed IS NULL AND created_at < now() - 5min
    """
```

### 触发条件

- `images_processed IS NULL`：图像处理从未开始
- `created_at < now() - 5min`：文章创建超过 5 分钟（避免误捕正在处理的文章）

### 处理逻辑

- 每次最多处理 50 篇文章
- 每篇文章间隔 2 秒调度
- 图像处理完成后，`scan_pending_rag_articles` 会自动捕获
