# 仓库相关任务

## 概述

仓库相关任务负责从文章中提取 GitHub 链接，同步用户的星标仓库，并进行 AI 分析。

## 文件位置

| 文件 | 功能 |
|------|------|
| `repository_tasks.py` | 仓库同步任务 |
| `repo_extractor.py` | 仓库提取任务 |

## 任务列表

| 任务名 | 文件 | 触发方式 | 功能 |
|--------|------|----------|------|
| `sync_repositories` | repository_tasks.py | 任务链/手动 | 同步 GitHub 星标仓库 |
| `extract_article_repos` | repo_extractor.py | 任务链 | 从文章提取 GitHub 链接 |
| `scan_pending_repo_extraction` | repo_extractor.py | Beat 每30分钟 | 扫描遗漏的提取 |

## extract_article_repos 任务

从文章内容中提取 GitHub 仓库链接。

```
extract_article_repos(article_id, user_id)
    │
    ├─ 1. 获取文章内容
    │
    ├─ 2. 正则提取 GitHub 链接
    │
    ├─ 3. 解析 owner/repo
    │
    ├─ 4. 调用 GitHub API 获取仓库数据
    │
    ├─ 5. 创建 article_repositories 关联
    │
    └─ 6. 触发 sync_repositories（如有新仓库）
```

### 常量

```python
BATCH_SIZE = 50              # 每次扫描最大文章数
GITHUB_API_TIMEOUT = 30      # API 超时（秒）
MAX_REPOS_PER_ARTICLE = 20   # 每篇文章最多提取的仓库数
```

## sync_repositories 任务

同步用户的 GitHub 星标仓库。

```
sync_repositories(user_id)
    │
    ├─ 1. 获取用户 GitHub token
    │
    ├─ 2. 获取所有星标仓库列表
    │
    ├─ 3. 对比数据库中的仓库
    │      ├─ 新仓库 → 获取 README
    │      ├─ pushed_at 变化 → 更新 README
    │      └─ README 为空 → 获取 README
    │
    ├─ 4. 并发获取 README（并发度 10）
    │
    ├─ 5. AI 分析（analyze_repositories_needing_analysis）
    │
    ├─ 6. 更新数据库
    │
    └─ 7. 调度下次自动同步（1 小时后）
```

### 同步间隔

```python
REPO_SYNC_INTERVAL_SECONDS = 3600  # 1 小时
```

## 任务链关系

```
process_article_rag (RAG 完成)
    ↓
extract_article_repos (提取仓库)
    ↓
sync_repositories (同步仓库，30秒延迟合并)
    ↓
调度下次同步（1 小时后）
```

## Beat 容错任务

每 30 分钟扫描遗漏的仓库提取：

```python
@app.task(name="scan_pending_repo_extraction")
def scan_pending_repo_extraction():
    """
    条件：rag_processed = true AND repos_extracted IS NULL
    """
```
