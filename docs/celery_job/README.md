# Celery 任务系统文档

> 本文档帮助新开发者快速理解 SaveHub 的后台任务系统

## 30秒快速了解

SaveHub 使用 **Celery + Redis** 处理后台任务，主要包括：

1. **RSS Feed 刷新** - 定时抓取订阅源的新文章
2. **图像处理** - 下载、压缩、上传文章中的图片
3. **RAG 处理** - 为文章生成向量嵌入，支持语义搜索
4. **仓库同步** - 同步 GitHub 星标仓库和文章中提取的仓库

## 文档导航

| 文档 | 内容 | 适合场景 |
|------|------|----------|
| [01_architecture.md](./01_architecture.md) | 架构概览、配置、队列 | 了解系统全貌 |
| [02_feed_tasks.md](./02_feed_tasks.md) | Feed 刷新任务链 | 理解 RSS 处理流程 |
| [03_image_tasks.md](./03_image_tasks.md) | 图像处理任务链 | 理解图片处理流程 |
| [04_rag_tasks.md](./04_rag_tasks.md) | RAG 处理任务链 | 理解向量化流程 |
| [05_repository_tasks.md](./05_repository_tasks.md) | 仓库同步和提取 | 理解 GitHub 集成 |
| [06_utilities.md](./06_utilities.md) | 工具类（锁、限流、错误处理） | 开发新任务前必读 |
| [07_add_new_task.md](./07_add_new_task.md) | **实战指南：添加新定时任务** | 开发新功能 |
| [08_debugging.md](./08_debugging.md) | 调试和监控指南 | 排查问题 |

## 任务总览

| 任务名 | 触发方式 | 功能 | 文件位置 |
|--------|----------|------|----------|
| `refresh_feed` | API/定时 | 刷新单个 Feed | `tasks.py` |
| `scan_due_feeds` | Beat 每分钟 | 扫描待刷新 Feed | `tasks.py` |
| `process_article_images` | 任务链 | 处理文章图片 | `image_processor.py` |
| `process_article_rag` | 任务链 | 生成文章 embedding | `rag_processor.py` |
| `scan_pending_rag_articles` | Beat 每30分钟 | 扫描遗漏的 RAG 文章 | `rag_processor.py` |
| `extract_article_repos` | 任务链 | 从文章提取 GitHub 链接 | `repo_extractor.py` |
| `scan_pending_repo_extraction` | Beat 每30分钟 | 扫描遗漏的仓库提取 | `repo_extractor.py` |
| `sync_repositories` | 任务链/手动 | 同步 GitHub 仓库 | `repository_tasks.py` |

## 核心文件路径

```
backend/app/celery_app/
├── celery.py           # Celery 配置入口
├── task_utils.py       # 共享工具（错误、上下文、结果构建）
├── tasks.py            # Feed 刷新任务
├── image_processor.py  # 图像处理任务
├── rag_processor.py    # RAG 处理任务
├── repository_tasks.py # 仓库同步任务
├── repo_extractor.py   # 仓库提取任务
├── task_lock.py        # Redis 分布式锁
└── rate_limiter.py     # 域名速率限制
```

## 快速启动命令

```bash
# 启动 Worker（处理任务）
celery -A app.celery_app worker --loglevel=info --queues=high,default

# 启动 Beat（定时调度）
celery -A app.celery_app beat --loglevel=info

# 启动 Flower（监控面板）
celery -A app.celery_app flower --port=5555
```
