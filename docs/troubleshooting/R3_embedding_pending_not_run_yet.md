# R3_embedding_pending_not_run_yet（仓库 embedding 一直 pending）

本文档用于解释诊断脚本中 `R3_embedding_pending_not_run_yet` 的含义、常见成因，以及推荐的解决方案。后续修复可以严格按本文档逐条落地。

背景：业务期望 `all_embeddings` 覆盖所有 `repositories`（每个仓库至少应有 1 条 chunk 向量）。

---

## 1. 定义（如何被判定为 R3）

在 `backend/scripts/038_diagnose_all_embeddings_missing_reasons.sql` 中，仓库满足以下条件会被归类为 R3：

- repositories.readme_content 非空（trim 后长度 > 0）
- repositories.embedding_processed IS NULL（未标记成功/失败）
- all_embeddings 中不存在该 repository_id 的记录

等价 SQL（简化版）：

    SELECT r.id
    FROM repositories r
    WHERE COALESCE(BTRIM(r.readme_content), '') <> ''
      AND r.embedding_processed IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM all_embeddings e WHERE e.repository_id = r.id
      );

---

## 2. 当前仓库 embedding 的处理链路（现状）

### 2.1 触发入口

仓库 embedding 目前主要在仓库同步任务中触发：

- backend/app/celery_app/repository_tasks.py → sync_repositories()
  - 在任务末尾调用 do_repository_embedding(user_id)
  - 注意：该阶段异常会被捕获并记录 warning，然后 sync 仍会返回 success，不会中断主流程

此外，接口侧（SSE 同步）也会调用同样逻辑。

### 2.2 待处理仓库筛选条件

在 backend/app/celery_app/repository_tasks.py → _get_repos_needing_embedding() 中：

- user_id = 当前用户
- embedding_processed IS NULL
- readme_content IS NOT NULL
- limit 50（每轮最多处理 50 个仓库）

### 2.3 状态写入方式

在 backend/app/services/db/rag.py → mark_repository_embedding_processed() 中写入：

- embedding_processed = TRUE/FALSE
- embedding_processed_at = now()

一旦被写成 FALSE，就不再被 _get_repos_needing_embedding 选中（因为只选 NULL），会变成 R2。

---

## 3. 为什么会出现大量 R3（按优先级排序）

### P0：仓库 embedding 代码在开始前就异常退出（典型：ModuleNotFoundError）

如果仓库 embedding 阶段在“进入循环处理仓库之前”就抛异常，那么 repositories.embedding_processed 不会被更新，导致大量仓库永远保持 NULL（R3）。

当前代码里存在一个高概率致命点：

- backend/app/celery_app/repository_tasks.py 的仓库 embedding 流程尝试导入 app.services.rag.embedder
- 但仓库内 backend/app/services/rag/ 目录下不存在 embedder.py（embedding 已迁移到 app.services.ai.EmbeddingClient）

这类问题通常能在日志里看到类似信息：

    Repository embedding during sync failed: No module named 'app.services.rag.embedder'

结论：只要 P0 存在，R3 就会一直高位。

### P1：用户缺少 embedding API 配置（任务被跳过，但不会落库状态）

do_repository_embedding() 会读取用户的 embedding 配置；如果缺失，会返回 skipped=True，但不会把 repositories.embedding_processed 从 NULL 改成 FALSE/TRUE。

结果：看起来“永远 pending”。

### P2：Celery worker/beat 未运行或触发频率不足

仓库 embedding 不是独立管道，更多依赖 sync_repositories 的触发；如果：

- worker 未运行
- 或用户很少触发仓库同步

则 R3 会长期存在。

### P3：批量上限导致积压（每轮最多 50 个）

即使一切正常，如果仓库数量远大于 50：

- 需要多轮任务才能把 pending 清零

---

## 4. 解决方案

### 4.1 立即排查（不改代码的验证步骤）

1) 看日志是否存在 “No module named app.services.rag.embedder” 或其它仓库 embedding 入口异常
2) 检查用户是否配置了 embedding 类型的 api_configs（不是 chat）
3) 确认 Celery worker 与 Celery Beat 是否常驻
4) 多次触发仓库同步，观察 R3 是否下降（若始终不变，优先怀疑 P0/P1/P2）

### 4.2 后续代码修复建议（需要改代码，先记录方案）

要真正消除大面积 R3，必须让仓库 embedding 稳定跑起来：

1) 修复仓库 embedding 的实现：移除对 app.services.rag.embedder 的依赖，改为使用 app.services.ai.EmbeddingClient.embed_batch()
2) 增加“仓库 embedding 兜底扫描任务”（类似文章 scan_pending_rag_articles）：定时扫描 embedding_processed IS NULL 的仓库并调度处理
3) 对大数据量场景提供批处理能力（例如循环跑 embedding 直到 pending 为 0，而不是每次只跑 50 个）

---

## 5. 验证与验收

推荐按以下顺序验收：

1) 运行 backend/scripts/038_diagnose_all_embeddings_missing_reasons.sql
   - 观察 R3 是否随着任务运行持续下降
2) 运行 backend/scripts/037_validate_all_embeddings_coverage.sql
   - 目标：repositories fully_covered = true

---

## 6. 关联问题

- 如果 R3 逐渐下降后仍有一小部分卡在失败且不重试，请参考：docs/troubleshooting/R2_embedding_failed_not_retried.md
