# 02｜RSS 刷新链路（定时 vs 手动）

RSS 刷新在后端 Celery 里分两种“编排模式”，但底层核心逻辑基本复用：

- **单 Feed 链路（Single）**：通常来自“新建 Feed/手动触发”（高优先级），并且任务会自我调度下一次。
- **批处理链路（Batch）**：由 Beat 每分钟扫描触发，按用户分组做编排，强调“全量有序”。

核心代码：`backend/app/celery_app/tasks.py`

---

## A. 单 Feed 链路（refresh_feed）

触发来源：
- 后端：`POST /feeds` 创建/保存 feed 后会调度一次 `refresh_feed`（queue=high）
- 后端：`POST /queue/schedule-feed` 可以手动/立即刷新某个 feed（queue=high 或 default）

任务：`refresh_feed`（`name="refresh_feed"`）

### refresh_feed 的内部顺序（高层）

1. **获取任务锁**（Redis）：锁 key = `feed:{feed_id}`，防止同一个 feed 并发刷新
2. **检查 feed 是否还存在**：如果用户删掉了 feed，则直接 `skipped: true`
3. **执行核心刷新逻辑**：调用 `do_refresh_feed(feed_id, feed_url, user_id)`
   - 3.1 域名级限流（避免把目标站点打爆）
   - 3.2 解析 RSS（`app.services.rss_parser.parse_rss_feed`）
   - 3.3 Upsert articles（重要：尽量复用旧 article id，避免 FK/all_embeddings 问题）
   - 3.4（非 batch 模式）调度图片处理 chord：`schedule_image_processing.delay(article_ids, feed_id)`
4. **更新 feeds 表状态**：`last_fetched / last_fetch_status / last_fetch_error`
5. **调度下一次刷新**：`schedule_next_refresh(feed_id, user_id, refresh_interval)`
6. **释放任务锁**

> 注意：`do_refresh_feed` 是“业务核心函数”，尽量与 Celery 解耦，方便测试/复用。

---

## B. 批处理链路（Beat → scan_due_feeds）

触发来源：
- Celery Beat：每分钟触发 `scan_due_feeds`

### 1）scan_due_feeds 做什么

`scan_due_feeds` 是一个“扫描 + 编排”任务，它的顺序是：

1. 获取全局锁：`scan_due_feeds`（TTL=55s，防止 Beat 重叠执行）
2. 拉取所有 feeds 的必要字段
3. 在代码里筛选“到期”的 feeds：
   - `last_fetched + refresh_interval <= now`，或 `last_fetched is null`
4. 按 `user_id` 分组
5. 对每个用户触发：`schedule_user_batch_refresh.delay(user_id, feeds)`

### 2）schedule_user_batch_refresh（每个用户一套 chord）

它会创建一个 chord：

- Header：`refresh_feed_batch` x N（并行刷新 N 个 feed）
- Callback：`on_user_feeds_complete`

### 3）refresh_feed_batch（Batch 版刷新）

与 `refresh_feed` 的关键区别：

- 调用 `do_refresh_feed(..., batch_mode=True)`：**不在这里调度图片处理**
- 不会 `schedule_next_refresh`：由 Beat 来决定下一轮扫描

### 4）on_user_feeds_complete（收集 article_ids → 触发图片批处理）

它会：

1. 统计本次 N 个 feed 的刷新结果（成功/失败/跳过）
2. 汇总所有新增文章 `article_ids`
3. 调度：`schedule_batch_image_processing.delay(all_article_ids, user_id)`

---

## C. 与前端“手动刷新”关系

你在前端看到的“刷新按钮”，目前主要是：

- **直接调用** `POST /rss/parse` → 前端把文章写入（不是走 Celery 链路）

因此它与定时任务（Celery）**不是同一条链路**：

- 前端手动刷新：只做 RSS 解析 + 写入文章（不会自动触发图片处理 / RAG / repo extraction）。
- Celery 刷新：RSS → 图片 → RAG → repo extraction（完整链路）。

如果想让“手动刷新”和“定时刷新”完全一致，应让前端按钮改为调用：

- `POST /queue/schedule-feed`（force_immediate=true），由后端统一走 `refresh_feed`。

