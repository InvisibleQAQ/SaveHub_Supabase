# RSS Feed 系统概述

本文档介绍 Glean 项目中 RSS Feed 更新机制的整体架构。

## 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| **任务队列** | arq + Redis | 后台定时任务调度 |
| **HTTP 客户端** | httpx | 异步 HTTP 请求 |
| **RSS 解析** | feedparser + BeautifulSoup + lxml | 解析 RSS/Atom 格式 |
| **数据库** | PostgreSQL + SQLAlchemy 2.0 (async) | 数据持久化 |
| **API 框架** | FastAPI | REST API 服务 |
| **前端状态** | TanStack Query + Zustand | 数据获取与状态管理 |
| **前端框架** | React + Vite + Tailwind CSS | 用户界面 |

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           用户浏览器                                  │
│                    (React + TanStack Query)                         │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP API
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      FastAPI REST API                                │
│                     (Port 8000)                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ /api/feeds   │  │ /api/entries │  │ /api/folders │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
┌──────────────────────┐        ┌──────────────────────┐
│     Redis            │◄───────│    arq Worker        │
│  (任务队列)           │        │  (后台任务)           │
│  Port 6379           │        │                      │
└──────────────────────┘        │  ┌────────────────┐  │
                                │  │ Cron: 15 min   │  │
                                │  │ Feed Fetcher   │  │
                                │  └────────────────┘  │
                                └──────────┬───────────┘
                                           │
                                           ▼
                                ┌──────────────────────┐
                                │   glean_rss 包        │
                                │  (feedparser)        │
                                │  RSS/Atom 解析        │
                                └──────────┬───────────┘
                                           │
                                           ▼
                                ┌──────────────────────┐
                                │    外部 RSS 源        │
                                │  (HTTP GET)          │
                                └──────────────────────┘
              ┌────────────────────────────┴────────────────────────────┐
              │                                                         │
              ▼                                                         ▼
┌──────────────────────┐                                    ┌──────────────────────┐
│   PostgreSQL         │                                    │    glean_database     │
│   (数据存储)          │◄───────────────────────────────────│    (SQLAlchemy 模型)   │
│   Port 5432          │                                    │                      │
└──────────────────────┘                                    └──────────────────────┘
```

## 数据流程

### 1. 定时更新流程 (每 15 分钟)

```
Cron Job (minute={0, 15, 30, 45})
    │
    ▼
scheduled_fetch()
    │
    ▼
fetch_all_feeds()
    │ 查询所有 status=ACTIVE 且 next_fetch_at <= now 的 Feed
    │
    ▼
对每个 Feed 入队 fetch_feed_task
    │
    ▼
fetch_feed_task(feed_id)
    │
    ├─► fetch_feed()  ─► HTTP GET (带 ETag/Last-Modified)
    │       │
    │       ├─► 304 Not Modified ─► 更新 last_fetched_at，结束
    │       │
    │       └─► 200 OK ─► 返回内容和缓存头
    │
    ├─► parse_feed() ─► feedparser 解析
    │
    ├─► 更新 Feed 元数据 (title, description, icon_url, ...)
    │
    ├─► 遍历 entries:
    │       │
    │       ├─► 按 GUID 检查是否已存在
    │       │
    │       └─► 新条目 ─► 插入 Entry 表
    │
    ├─► 设置 next_fetch_at = now + 15 min
    │
    └─► 提交事务
```

### 2. 用户订阅流程

```
用户输入 URL
    │
    ▼
POST /api/feeds/discover
    │
    ▼
discover_feed(url)
    │
    ├─► 尝试直接解析为 RSS
    │
    └─► 若是 HTML，搜索 <link type="application/rss+xml">
    │
    ▼
创建或复用 Feed 记录
    │
    ▼
创建 Subscription (user_id + feed_id)
    │
    ▼
入队 fetch_feed_task 立即拉取
```

### 3. 前端展示流程

```
ReaderPage 组件挂载
    │
    ▼
useEntries() Hook
    │
    ▼
TanStack Query: GET /api/entries
    │
    ▼
EntryService.getEntries()
    │ 过滤: feed_id, folder_id, is_read, is_liked, read_later
    │ 分页: page, per_page
    │
    ▼
渲染 EntryListItem 列表
    │
    ▼
用户点击条目
    │
    ▼
useUpdateEntryState() ─► PATCH /api/entries/{id}
    │
    ▼
创建/更新 UserEntry 记录 (is_read=true, read_at=now)
```

## 核心数据模型

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│    User     │────<│  Subscription   │>────│    Feed     │
└─────────────┘     └─────────────────┘     └──────┬──────┘
      │                                            │
      │             ┌─────────────────┐            │
      └────────────<│   UserEntry     │>───────────┼────────┐
                    └─────────────────┘            │        │
                                                   ▼        │
                                            ┌─────────────┐ │
                                            │   Entry     │◄┘
                                            └─────────────┘
```

- **Feed**: 全局共享的 RSS 源，避免重复拉取
- **Entry**: 全局共享的文章条目
- **Subscription**: 用户与 Feed 的关联
- **UserEntry**: 用户对 Entry 的个人状态 (已读、喜欢、稍后阅读)

## 关键设计决策

1. **Feed 全局共享**: 多用户订阅同一源时，只需拉取一次
2. **条件请求**: 使用 ETag/Last-Modified 减少带宽
3. **GUID 去重**: 根据 Entry 的 GUID 判断是否已存在
4. **懒加载 UserEntry**: 仅在用户交互时创建记录
5. **错误指数退避**: 失败后延长重试间隔 (15→30→60 分钟)
6. **自动禁用**: 连续 10 次失败后将 Feed 标记为 ERROR

## 相关文档

- [02-后台任务详解](./02-rss-worker-tasks.md)
- [03-RSS 解析模块](./03-rss-parsing.md)
- [04-数据库模型](./04-rss-database.md)
- [05-API 接口](./05-rss-api.md)
- [06-前端展示](./06-rss-frontend.md)
