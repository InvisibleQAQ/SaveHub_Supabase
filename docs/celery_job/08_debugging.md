# 调试和监控指南

## Flower 监控面板

Flower 是 Celery 的 Web 监控工具。

### 启动 Flower

```bash
celery -A app.celery_app flower --port=5555
```

访问 http://localhost:5555

### 主要功能

| 页面 | 功能 |
|------|------|
| Dashboard | 任务统计、Worker 状态 |
| Tasks | 任务列表、状态、结果 |
| Workers | Worker 详情、并发数 |
| Broker | Redis 队列状态 |

## 日志查看

### Worker 日志

```bash
# 启动时指定日志级别
celery -A app.celery_app worker --loglevel=debug

# 日志级别：debug < info < warning < error
```

### 任务日志格式

```
[2024-01-15 10:30:00] INFO: Starting refresh_feed: attempt=1/4
[2024-01-15 10:30:05] INFO: Completed successfully: articles_count=5
```

## 常见问题排查

### 1. 任务卡住不执行

**检查 Worker 是否运行**
```bash
celery -A app.celery_app inspect active
```

**检查队列是否有任务**
```bash
celery -A app.celery_app inspect reserved
```

### 2. 任务被锁定

**查看 Redis 锁**
```bash
redis-cli keys "feed:*"
redis-cli ttl "feed:xxx-xxx-xxx"
```

**手动释放锁**
```bash
redis-cli del "feed:xxx-xxx-xxx"
```

### 3. Beat 定时任务不触发

**检查 Beat 是否运行**
```bash
ps aux | grep "celery beat"
```

**查看 Beat 日志**
```bash
celery -A app.celery_app beat --loglevel=debug
```

### 4. Chord 回调不执行

**检查所有子任务是否完成**
```bash
celery -A app.celery_app inspect active
```

**查看 Redis 中的 Chord 状态**
```bash
redis-cli keys "celery-taskset-*"
```

## Redis 队列检查

```bash
# 查看队列长度
redis-cli llen celery

# 查看高优先级队列
redis-cli llen high

# 查看默认队列
redis-cli llen default

# 清空队列（谨慎使用）
redis-cli del celery
```

## 手动触发任务

```python
# Python shell
from app.celery_app.tasks import refresh_feed

# 异步执行
task = refresh_feed.apply_async(
    kwargs={
        "feed_id": "xxx",
        "feed_url": "https://example.com/rss",
        "feed_title": "Test",
        "user_id": "xxx",
        "refresh_interval": 60,
    },
    queue="high"
)

# 查看任务状态
print(task.status)  # PENDING, STARTED, SUCCESS, FAILURE

# 获取结果
print(task.get(timeout=60))
```
