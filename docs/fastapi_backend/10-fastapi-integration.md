# FastAPI 集成概述与架构设计

## 概述

本项目将 RSS 订阅源更新功能从 Next.js API 路由迁移到 FastAPI 后端。迁移的主要目的是利用 Python 生态系统，为后续的 RAG（检索增强生成）功能做准备。

## 迁移范围

### 需要迁移的组件

| 组件 | 原实现 | 新实现 |
|------|--------|--------|
| RSS 解析 API | Next.js API Routes + rss-parser | FastAPI + feedparser |
| 后台任务队列 | BullMQ + Redis | Celery + Redis |
| 定时调度 | BullMQ Scheduler | Celery Beat |

### 保持不变的组件

- 前端 React 组件
- Zustand 状态管理
- Supabase 数据库（PostgreSQL）
- 用户认证（Supabase Auth）

## 系统架构

### 当前架构 (Next.js)

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│                   (React + Zustand)                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Next.js API Routes                        │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ /api/rss/parse  │  │ /api/scheduler  │                   │
│  │ /api/rss/validate│  │   /schedule     │                   │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────┐         ┌──────────────────────┐
│      Supabase        │         │    BullMQ Worker     │
│    (PostgreSQL)      │         │    (Node.js)         │
└──────────────────────┘         └──────────────────────┘
                                          │
                                          ▼
                                 ┌──────────────────────┐
                                 │       Redis          │
                                 └──────────────────────┘
```

### 目标架构 (Next.js + FastAPI)

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│                   (React + Zustand)                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Server                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Proxy: /api/backend/* → FastAPI /api/*             │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                           │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ /api/rss/parse  │  │ /api/scheduler  │                   │
│  │ /api/rss/validate│  │   /schedule     │                   │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────┐         ┌──────────────────────┐
│      Supabase        │         │   Celery Worker      │
│    (PostgreSQL)      │         │    (Python)          │
└──────────────────────┘         └──────────────────────┘
                                          │
                                          ▼
                                 ┌──────────────────────┐
                                 │       Redis          │
                                 └──────────────────────┘
```

## 技术选型

### 为什么选择 FastAPI

1. **Python 生态系统**: 为后续 RAG 功能提供丰富的 NLP/ML 库支持
2. **高性能**: 基于 Starlette 和 Pydantic，性能接近 Node.js
3. **类型安全**: 自动请求验证和 OpenAPI 文档生成
4. **异步支持**: 原生 async/await 支持

### 为什么选择 Celery

1. **成熟稳定**: Python 后台任务的行业标准
2. **功能丰富**: 支持重试、调度、优先级、结果后端
3. **Redis 兼容**: 可复用现有 Redis 基础设施
4. **可扩展**: 支持多 worker 水平扩展

### 为什么选择 feedparser

1. **Python 原生**: 无需 Node.js 进程间通信
2. **功能完善**: 支持 RSS 1.0/2.0、Atom、自动编码检测
3. **健壮性**: 对格式不规范的 feed 有良好容错

## 数据库访问策略

### SQLAlchemy ORM

选择使用 SQLAlchemy ORM 而非 Supabase Python SDK：

**优点**:
- 更 Pythonic 的 API
- 已在 FastAPI 后端使用（chat 功能）
- 更好的类型提示支持
- 事务控制更灵活

**注意事项**:
- 绕过 Supabase RLS（行级安全）
- 需要在应用层实现用户隔离（`user_id` 过滤）
- 使用与 Supabase 相同的 PostgreSQL 连接

## 认证策略

### JWT Token 传递

```
Frontend → Next.js Proxy → FastAPI
         (带 Supabase JWT)
```

1. 前端请求携带 Supabase JWT（Authorization header）
2. Next.js 代理透传 header 到 FastAPI
3. FastAPI 验证 JWT（调用 Supabase Auth API）
4. 从 JWT 中提取 `user_id` 用于数据库查询

### 现有验证逻辑

FastAPI 已有 JWT 验证实现（`backend/app/dependencies.py`）：

```python
async def verify_jwt(authorization: str = Header(...)):
    token = authorization.replace("Bearer ", "")
    user = supabase.auth.get_user(token)
    return user
```

## API 端点映射

### 代理配置

`next.config.mjs` 中的 rewrite 规则：

```javascript
async rewrites() {
  return [
    {
      source: "/api/backend/:path*",
      destination: "http://127.0.0.1:8000/api/:path*",
    },
  ]
}
```

### 端点对应关系

| 前端调用 | 代理后 | FastAPI 处理 |
|----------|--------|--------------|
| `/api/backend/rss/validate` | `/api/rss/validate` | `rss.router` |
| `/api/backend/rss/parse` | `/api/rss/parse` | `rss.router` |
| `/api/backend/scheduler/schedule` | `/api/scheduler/schedule` | `scheduler.router` |
| `/api/backend/scheduler/cancel` | `/api/scheduler/cancel` | `scheduler.router` |

## 迁移策略

### 渐进式迁移

1. **阶段一**: 部署 FastAPI 新端点（与 Node.js 并存）
2. **阶段二**: 更新前端调用路径到 `/api/backend/*`
3. **阶段三**: 并行运行两套系统，监控稳定性
4. **阶段四**: 停用 Node.js 端点和 BullMQ worker

### 回滚方案

- 前端可快速切换回 `/api/rss/*`（原 Next.js 端点）
- Node.js 端点在过渡期保持可用
- 数据库结构不变，无数据迁移风险

## 目录结构

```
backend/
├── app/
│   ├── api/
│   │   └── routers/
│   │       ├── chat.py           # 现有：聊天功能
│   │       ├── rss.py            # 新增：RSS 解析
│   │       └── scheduler.py      # 新增：任务调度
│   ├── models/
│   │   ├── __init__.py
│   │   ├── profile.py            # 现有
│   │   ├── chat_session.py       # 现有
│   │   ├── message.py            # 现有
│   │   ├── feed.py               # 新增：Feed 模型
│   │   └── article.py            # 新增：Article 模型
│   ├── schemas/
│   │   ├── chat.py               # 现有
│   │   ├── rss.py                # 新增：RSS 请求/响应
│   │   └── scheduler.py          # 新增：调度器请求/响应
│   ├── services/
│   │   ├── chat_service.py       # 现有
│   │   └── rss_parser.py         # 新增：feedparser 封装
│   ├── tasks/
│   │   ├── __init__.py           # 新增
│   │   ├── celery_config.py      # 新增：Celery 配置
│   │   └── rss_tasks.py          # 新增：RSS 刷新任务
│   ├── core/
│   │   └── rate_limiter.py       # 新增：域名限速
│   ├── database.py               # 现有
│   ├── dependencies.py           # 现有：JWT 验证
│   └── main.py                   # 修改：添加新路由
├── celery_worker.py              # 新增：Celery 入口
├── pyproject.toml                # 修改：添加依赖
└── .env                          # 修改：添加 Redis 配置
```

## 下一步

1. [FastAPI 后端环境搭建指南](./11-fastapi-backend-setup.md)
2. [RSS 功能迁移详细步骤](./12-rss-migration-to-fastapi.md)
3. [Celery 后台任务系统实现](./13-celery-background-jobs.md)
4. [前端集成与代理配置](./14-frontend-integration.md)
