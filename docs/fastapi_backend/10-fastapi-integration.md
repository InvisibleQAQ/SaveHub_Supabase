# FastAPI 集成概述与架构设计

## 概述

本项目将 RSS 订阅源更新功能从 Next.js API 路由迁移到 FastAPI 后端。迁移的主要目的是利用 Python 生态系统，为后续的 RAG（检索增强生成）功能做准备。

## 迁移范围

### 需要迁移的组件

| 组件         | 原实现                          | 新实现               |
| ------------ | ------------------------------- | -------------------- |
| RSS 解析 API | Next.js API Routes + rss-parser | FastAPI + feedparser |
| 后台任务队列 | BullMQ + Redis                  | Celery + Redis       |
| 定时调度     | BullMQ Scheduler                | Celery Beat          |

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

### Supabase Python SDK（唯一方案）

本项目**仅使用 Supabase Python SDK**，不使用 SQLAlchemy ORM。

**核心优势**:

- **与前端一致**：前后端使用相同的 HTTPS API 访问模式
- **无需直连数据库**：避免 `db.*.supabase.co` 连接问题（防火墙、暂停项目等）
- **RLS 自动生效**：自动应用 Supabase 行级安全策略
- **强类型约束**：FastAPI + Pydantic 提供完整类型安全
- **简化维护**：无需维护 SQLAlchemy models、migrations

**Pydantic 强类型 + Supabase SDK 模式**:

```python
from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from datetime import datetime

# 1. Pydantic 模型定义数据结构（强类型）
class Feed(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    url: str
    description: Optional[str] = None
    unread_count: int = 0
    last_fetched: Optional[datetime] = None

    class Config:
        from_attributes = True

# 2. 类型化的数据库操作函数
async def get_user_feeds(supabase_client, user_id: str) -> List[Feed]:
    """获取用户的所有订阅源（强类型返回）"""
    response = supabase_client.table("feeds") \
        .select("*") \
        .eq("user_id", user_id) \
        .order("created_at", desc=True) \
        .execute()

    # Pydantic 自动验证和类型转换
    return [Feed(**item) for item in response.data]

# 3. 在 FastAPI 端点中使用
@router.get("/feeds", response_model=List[Feed])
async def list_feeds(user=Depends(verify_jwt)):
    supabase = get_supabase_client(user.session.access_token)
    return await get_user_feeds(supabase, user.user.id)
```

**两种客户端模式**:

| 场景 | 客户端 | RLS |
|------|--------|-----|
| API 请求（用户操作） | `get_supabase_client(access_token)` | 生效 |
| 后台任务（Celery） | `get_service_client()` | 绕过 |

**注意事项**:

- API 请求需携带 JWT Token（`Authorization: Bearer <token>`）
- Service Role Key 仅用于后台任务，绕过 RLS

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

| 前端调用                            | 代理后                      | FastAPI 处理         |
| ----------------------------------- | --------------------------- | -------------------- |
| `/api/backend/rss/validate`       | `/api/rss/validate`       | `rss.router`       |
| `/api/backend/rss/parse`          | `/api/rss/parse`          | `rss.router`       |
| `/api/backend/scheduler/schedule` | `/api/scheduler/schedule` | `scheduler.router` |
| `/api/backend/scheduler/cancel`   | `/api/scheduler/cancel`   | `scheduler.router` |

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
│   │       ├── rss.py            # RSS 解析 API
│   │       └── scheduler.py      # 任务调度 API（后续）
│   ├── schemas/
│   │   ├── rss.py                # RSS 请求/响应 Pydantic 模型
│   │   ├── feed.py               # Feed Pydantic 模型
│   │   ├── article.py            # Article Pydantic 模型
│   │   └── scheduler.py          # 调度器请求/响应（后续）
│   ├── services/
│   │   ├── rss_parser.py         # feedparser 封装
│   │   └── supabase_db.py        # Supabase 数据库操作（强类型）
│   ├── tasks/                    # Celery 任务（后续）
│   │   ├── __init__.py
│   │   ├── celery_config.py
│   │   └── rss_tasks.py
│   ├── core/
│   │   └── rate_limiter.py       # 域名限速（后续）
│   ├── supabase_client.py        # Supabase 客户端（替代 database.py）
│   ├── dependencies.py           # JWT 验证 + Supabase 依赖
│   └── main.py                   # FastAPI 应用入口
├── celery_worker.py              # Celery 入口（后续）
├── requirements.txt              # pip 依赖
└── .env                          # 环境变量
```

**架构说明**：
- **无 SQLAlchemy**：不使用 `models/` 目录和 `database.py`
- **Pydantic 模型**：所有数据结构定义在 `schemas/`
- **Supabase SDK**：通过 `supabase_client.py` 访问数据库

## 下一步

1. [FastAPI 后端环境搭建指南](./11-fastapi-backend-setup.md)
2. [RSS 功能迁移详细步骤](./12-rss-migration-to-fastapi.md)
3. [Celery 后台任务系统实现](./13-celery-background-jobs.md)
4. [前端集成与代理配置](./14-frontend-integration.md)
