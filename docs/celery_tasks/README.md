# Celery 定时任务（速查）

本目录聚焦 SaveHub 后端 Celery 的「定时/后台任务」：任务有哪些、如何调度、以及每个任务内部的大致执行顺序（高层）。

建议阅读顺序：
1. `01_定时任务清单.md`
2. `02_RSS刷新链路.md`
3. `03_图片处理与RAG链路.md`
4. `04_仓库提取与同步.md`
5. `05_前端手动触发对照.md`

关键源码入口：
- `backend/app/celery_app/celery.py`：Celery 配置 + Beat 周期任务（`beat_schedule`）
- `backend/app/celery_app/tasks.py`：RSS 刷新 + Batch 编排（`scan_due_feeds` 等）
- `backend/app/celery_app/image_processor.py`：文章图片下载/压缩/上传
- `backend/app/celery_app/rag_processor.py`：RAG 分块 + Embedding + 兜底扫描
- `backend/app/celery_app/repo_extractor.py`：从文章提取 GitHub 仓库 + 兜底扫描
- `backend/app/celery_app/repository_tasks.py`：同步 Star 仓库 + AI 分析 + OpenRank + Embedding

本地跑起来（可选）：
- `pnpm dev:celery`：前端 + 后端 + Celery worker
- `pnpm dev:all`：前端 + 后端 + worker + Flower

