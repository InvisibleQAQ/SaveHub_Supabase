# 实战指南：添加新定时任务

## 快速开始

添加新定时任务需要 5 个步骤：

1. 创建任务文件
2. 定义任务函数
3. 注册到 celery.py
4. 配置 Beat 定时任务
5. 测试和验证

## 步骤 1：创建任务文件

在 `backend/app/celery_app/` 目录下创建新文件：

```bash
touch backend/app/celery_app/my_tasks.py
```

## 步骤 2：定义任务函数

### 基础模板

```python
"""
My custom Celery tasks.
"""

import logging
from typing import Dict, Any

from .celery import app
from .supabase_client import get_supabase_service
from .task_utils import (
    task_context,
    build_task_result,
    NonRetryableError,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Core Logic (decoupled from Celery for testing)
# =============================================================================

def do_my_task(resource_id: str, user_id: str) -> Dict[str, Any]:
    """
    核心业务逻辑，与 Celery 解耦便于测试。
    """
    supabase = get_supabase_service()

    # 你的业务逻辑
    result = {"processed": 1}

    return result


# =============================================================================
# Celery Task
# =============================================================================

@app.task(
    bind=True,
    name="my_task",
    max_retries=3,
    default_retry_delay=60,
    time_limit=300,
    soft_time_limit=270,
)
def my_task(self, resource_id: str, user_id: str):
    """
    我的自定义任务。
    """
    with task_context(self, resource_id=resource_id, user_id=user_id) as ctx:
        ctx.log_start("Processing my task")

        try:
            result = do_my_task(resource_id, user_id)
            ctx.log_success(f"Completed: {result}")
            return build_task_result(ctx, success=True, **result)

        except Exception as e:
            ctx.log_exception(e)
            return build_task_result(ctx, success=False, error=str(e))
```

### 带任务锁的模板

```python
from celery.exceptions import Reject
from .task_lock import get_task_lock
from .task_utils import acquire_task_lock

@app.task(bind=True, name="my_locked_task")
def my_locked_task(self, resource_id: str, skip_lock: bool = False):
    task_lock = get_task_lock()
    lock_key = f"resource:{resource_id}"
    lock_ttl = 180

    with task_context(self, resource_id=resource_id) as ctx:
        if not acquire_task_lock(ctx, task_lock, lock_key, lock_ttl, skip_lock):
            raise Reject(f"Resource {resource_id} is locked", requeue=False)

        try:
            result = do_my_task(resource_id)
            return build_task_result(ctx, success=True, **result)
        finally:
            task_lock.release(lock_key, ctx.task_id)
```

## 步骤 3：注册到 celery.py

编辑 `celery.py`，添加模块到 `include` 列表：

```python
app = Celery(
    "savehub",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.celery_app.tasks",
        "app.celery_app.image_processor",
        "app.celery_app.rag_processor",
        "app.celery_app.repository_tasks",
        "app.celery_app.repo_extractor",
        "app.celery_app.my_tasks",  # 添加这行
    ]
)
```

添加任务路由（可选）：

```python
task_routes={
    # ... 现有路由
    "my_task": {"queue": "default"},
}
```

## 步骤 4：配置 Beat 定时任务

在 `celery.py` 的 `beat_schedule` 中添加：

```python
beat_schedule={
    # ... 现有定时任务

    # 每小时执行一次
    "my-task-every-hour": {
        "task": "my_task",
        "schedule": crontab(minute=0),  # 每小时整点
    },

    # 每 5 分钟执行一次
    "my-task-every-5-minutes": {
        "task": "my_task",
        "schedule": crontab(minute="*/5"),
    },

    # 每天凌晨 3 点执行
    "my-task-daily": {
        "task": "my_task",
        "schedule": crontab(hour=3, minute=0),
    },
},
```

## 步骤 5：测试和验证

### 手动触发测试

```python
# 在 Python shell 中
from app.celery_app.my_tasks import my_task

# 同步执行（调试用）
result = my_task("resource_id", "user_id")

# 异步执行
task = my_task.delay("resource_id", "user_id")
print(task.id)
```

### 启动 Worker 测试

```bash
# 启动 Worker
celery -A app.celery_app worker --loglevel=info --queues=high,default

# 启动 Beat（另一个终端）
celery -A app.celery_app beat --loglevel=info
```

## 最佳实践清单

- [ ] 核心逻辑与 Celery 解耦（便于单元测试）
- [ ] 使用 `task_context` 管理日志和计时
- [ ] 使用 `build_task_result` 返回标准化结果
- [ ] 区分可重试和不可重试错误
- [ ] 需要防重复时使用任务锁
- [ ] 设置合理的超时时间
- [ ] 添加到 `include` 列表
- [ ] 配置任务路由（可选）
- [ ] 配置 Beat 定时任务
