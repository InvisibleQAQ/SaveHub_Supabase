# 03｜图片处理与 RAG 链路（内部顺序）

本文只讲“任务链路顺序”和每步做什么（简述）。

核心代码：
- `backend/app/celery_app/image_processor.py`
- `backend/app/celery_app/rag_processor.py`

---

## A. 图片处理：process_article_images

触发方式：
- 单 feed 模式：`schedule_image_processing(article_ids, feed_id)` 创建 chord
- batch 模式：`schedule_batch_image_processing(article_ids, user_id)` 创建 chord

### 1）schedule_image_processing / schedule_batch_image_processing（编排任务）

它们都会做同一件事：

1. 创建 `group(process_article_images.s(article_id=...))`（并行处理每篇文章图片）
2. chord callback：
   - 单 feed：`on_images_complete(image_results, article_ids, feed_id)`
   - batch：`on_batch_images_complete(image_results, article_ids, user_id)`

### 2）process_article_images 的内部顺序（高层）

实际工作由 `do_process_article_images(article_id)` 完成：

1. 从 `articles` 表读取 `content / user_id / images_processed`
2. **幂等判断**：如果 `images_processed` 非空，直接 `skipped`
3. 解析 HTML，遍历 `<img src=...>`
   - 跳过 data URL / 已经是 supabase storage 的图片
   - 下载图片（带 SSRF 防护：私网 IP 拦截）
   - 压缩（失败就用原图）
   - 上传到 Supabase Storage（bucket: `article-images`）
   - 把 HTML 里的 `img.src` 替换成新 URL
4. 更新文章：`content` + `images_processed` + `images_processed_at`

> 设计要点：单篇文章处理失败不会抛异常阻断 chord，任务会返回 `{success: false, error: ...}`，让回调还能执行。

---

## B. RAG 处理：process_article_rag

RAG 的触发方式（两条）：

1. **主链路**：图片 chord 回调里调度 `process_article_rag`
   - `on_images_complete` → `schedule_rag_for_articles(article_ids)`
   - `on_batch_images_complete` → `schedule_rag_for_articles(article_ids)`
2. **兜底链路（Beat）**：`scan_pending_rag_articles` 每 30 分钟扫描并补跑

### 1）schedule_rag_for_articles（批量调度 + 失败重试补齐）

高层顺序：

1. 根据 `article_ids` 查出对应 `user_id`
2. 按用户分组，并把该用户其它 pending/failed 的文章也一起追加进来（最多 `BATCH_SIZE`）
3. 用错峰 `countdown` 调度 `process_article_rag`：每个任务间隔 3 秒，避免 API 速率限制

### 2）process_article_rag 的内部顺序（高层）

实际工作由 `do_process_article_rag(article_id, user_id)` 完成：

1. 读取文章（包含 `content/title/author/url/rag_processed`）
2. 幂等判断：`rag_processed = true` 则跳过
3. 获取用户的 chat + embedding 配置（缺失则标记失败并返回）
4. 解析文章 HTML，按原始顺序抽取“文本 + 图片”结构
5. 对图片生成 caption（Vision，最多 10 张）
6. 用 caption 替换原图位置，得到完整文本
7. 语义分块（失败则 fallback 分块）
8. 批量 embedding
9. 写入 embeddings 表（通过 `RagService`）
10. 更新文章 `rag_processed` 状态

### 3）RAG 完成后：自动触发文章仓库提取

在 `process_article_rag` 成功后，会额外调度：

- `extract_article_repos(article_id, user_id)`（countdown=1s）

这使得“RSS → 图片 → RAG → 仓库提取”成为一条连续链路。

