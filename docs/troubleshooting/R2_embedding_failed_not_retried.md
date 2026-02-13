# R2_embedding_failed_not_retried（仓库 embedding 失败且不会自动重试）

本文档用于解释诊断脚本中 `R2_embedding_failed_not_retried` 的含义、常见成因，以及推荐的解决方案。后续修复可以严格按本文档逐条落地。

背景：业务期望 `all_embeddings` 覆盖所有 `repositories`（每个仓库至少应有 1 条 chunk 向量）。

---

## 1. 定义（如何被判定为 R2）

在 `backend/scripts/038_diagnose_all_embeddings_missing_reasons.sql` 中，仓库满足以下条件会被归类为 R2：

- repositories.readme_content 非空（trim 后长度 > 0）
- repositories.embedding_processed = FALSE
- all_embeddings 中不存在该 repository_id 的记录

等价 SQL（简化版）：

    SELECT r.id
    FROM repositories r
    WHERE COALESCE(BTRIM(r.readme_content), '') <> ''
      AND r.embedding_processed = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM all_embeddings e WHERE e.repository_id = r.id
      );

---

## 2. 为什么会“失败且不重试”（现状机制）

### 2.1 失败是如何写入的

当仓库 embedding 过程中发生异常，会把仓库标记为失败：

- backend/app/celery_app/repository_tasks.py → _process_single_repository_embedding()
  - except 分支会调用 RagService.mark_repository_embedding_processed(repository_id, success=False)

落库效果：

- repositories.embedding_processed = FALSE
- repositories.embedding_processed_at = now()

### 2.2 为什么不会自动重试

待处理仓库的筛选条件只包含 `embedding_processed IS NULL`：

- backend/app/celery_app/repository_tasks.py → _get_repos_needing_embedding()

也就是说：

- `NULL` = 会被继续处理（pending）
- `FALSE` = 永远不会再进入处理列表（除非人工或代码修改）

这就是 `R2_embedding_failed_not_retried` 的直接原因。

---

## 3. 常见成因（导致 embedding 失败的原因）

这里列出“会把 embedding_processed 写成 FALSE”的常见原因（不一定穷尽）：

1) Embedding API 配置问题（无效 key/base/model、base_url 未规范化、服务不可用等）
2) 第三方 API 限流/超时/网络抖动导致的任务失败
3) 单条文本过长或输入触发 provider 限制
4) 数据问题：readme_content 有但拼接后 full_text 为空/异常字符导致 chunking 或 embedding 报错
5) 代码问题：embedding 逻辑抛异常（例如调用不存在函数、依赖缺失等）

> 注意：如果 embedding 流程在“开始前导入阶段”就失败，通常不会写入 FALSE，而是大量停留在 NULL（见 R3 文档：docs/troubleshooting/R3_embedding_pending_not_run_yet.md）。

---

## 4. 解决方案

### 4.1 运维止血：把失败记录重新打回 pending（不改代码）

如果你确认失败原因已经修复（例如：修好了 API 配置、修好了代码 bug），可以把失败的仓库重置回 pending，交给现有任务重新跑。

推荐 SQL（只重置“确实还没有 embedding”的仓库，避免误伤已经生成的）：

```sql
UPDATE repositories r
SET embedding_processed = NULL,
    embedding_processed_at = NULL
WHERE r.embedding_processed = FALSE
  AND COALESCE(BTRIM(r.readme_content), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM all_embeddings e WHERE e.repository_id = r.id
  );
```

执行后：这些仓库会从 R2 变回 R3（pending）。

### 4.2 代码层修复：引入“失败可重试”的状态机（后续要做）

建议至少做其中一种：

方案 A（最小改动）：

- _get_repos_needing_embedding() 同时筛选 `embedding_processed IS NULL OR embedding_processed = FALSE`
- 并引入简单的重试次数上限（否则永久失败会无限循环）

方案 B（推荐）：

- 把 repositories.embedding_processed 从 boolean 升级为更明确的状态机字段，例如：
  - pending / processing / success / failed / skipped
- 同时记录：
  - last_embedding_error
  - embedding_attempts
  - last_attempt_at

这样可以：

- 自动重试“偶发失败”
- 避免永久失败无限重试
- 更方便排障与可观测性

---

## 5. 验证与验收

推荐按以下顺序验收：

1) （可选）执行“重置失败仓库为 pending”的 SQL（见 4.1）
2) 触发仓库 embedding 跑一轮/多轮
3) 再运行 backend/scripts/038_diagnose_all_embeddings_missing_reasons.sql
   - 目标：R2 数量下降
4) 最终运行 backend/scripts/037_validate_all_embeddings_coverage.sql
   - 目标：repositories fully_covered = true
