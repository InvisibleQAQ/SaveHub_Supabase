# 工具类

## 概述

工具类提供了 Celery 任务的共享功能，包括错误处理、任务锁、速率限制等。

## 文件列表

| 文件 | 功能 |
|------|------|
| `task_utils.py` | 错误层级、TaskContext、结果构建 |
| `task_lock.py` | Redis 分布式锁 |
| `rate_limiter.py` | 域名速率限制 |
| `async_utils.py` | 异步-同步桥接 |
| `supabase_client.py` | Supabase 服务角色客户端 |

## 错误层级体系

**位置**: `task_utils.py:24-130`

```
TaskError (基类)
├── RetryableError          # 触发重试
│   ├── RetryableFeedError
│   ├── RetryableImageError
│   ├── EmbeddingError
│   └── RateLimitError
└── NonRetryableError       # 不重试
    ├── NonRetryableFeedError
    ├── NonRetryableImageError
    ├── ConfigError
    ├── ChunkingError
    └── RepoExtractionError
```

### 使用示例

```python
from .task_utils import RetryableFeedError, NonRetryableFeedError

try:
    result = fetch_rss(url)
except TimeoutError:
    raise RetryableFeedError("Network timeout")  # 会重试
except ParseError:
    raise NonRetryableFeedError("Invalid RSS")   # 不重试
```

## TaskContext 上下文

**位置**: `task_utils.py:191-322`

提供任务执行的上下文管理，包括计时和日志。

```python
from .task_utils import task_context, build_task_result

@app.task(bind=True, name="my_task")
def my_task(self, article_id: str):
    with task_context(self, article_id=article_id) as ctx:
        ctx.log_start("Processing article")

        result = do_work(article_id)

        ctx.log_success(f"Completed: {result['count']} items")
        return build_task_result(ctx, success=True, **result)
```

### TaskContext 方法

| 方法 | 用途 |
|------|------|
| `log_start(message)` | 记录任务开始 |
| `log_success(message)` | 记录成功（含耗时） |
| `log_error(error)` | 记录错误（含耗时） |
| `log_exception(error)` | 记录异常（含堆栈） |
| `duration_ms` | 获取耗时（毫秒） |

## 任务锁

**位置**: `task_lock.py`

防止同一资源被重复处理。

```python
from .task_lock import get_task_lock
from .task_utils import acquire_task_lock

task_lock = get_task_lock()
lock_key = f"feed:{feed_id}"
lock_ttl = 180  # 3 分钟

if not acquire_task_lock(ctx, task_lock, lock_key, lock_ttl, skip_lock):
    raise Reject(f"Feed {feed_id} is locked", requeue=False)

try:
    # 业务逻辑
finally:
    task_lock.release(lock_key, ctx.task_id)
```

## 错开延迟常量

**位置**: `task_utils.py:361-367`

```python
STAGGER_DELAY_TRIGGER = 1    # 快速触发（RAG → 仓库提取）
STAGGER_DELAY_FAST = 2       # 快速任务（仓库提取批量）
STAGGER_DELAY_NORMAL = 3     # 普通任务（RAG 处理）
STAGGER_DELAY_BATCH = 5      # 批量调度（Feed 批量）
STAGGER_DELAY_MERGE = 30     # 合并窗口（同步触发防抖）
```
