# FastAPI 集成方案

## 概述

在现有 Next.js + Supabase RSS Reader 项目中集成 FastAPI 后端，用于 RSS 任务调度、Chat 功能和 RAG 语义搜索。

**参考项目**: `reference_repository/nextjs-starter-template/backend` - 提供了经过验证的 FastAPI + Langchain + Supabase 集成模式。

## 相关文档

本系列文档详细说明如何将 RSS Reader 项目从 BullMQ 迁移到 FastAPI + Celery，并添加 Chat 功能：

| 文档                                                               | 内容                                    | 阶段   |
| ------------------------------------------------------------------ | --------------------------------------- | ------ |
| **[11-fastapi-backend-setup.md](./11-fastapi-backend-setup.md)**   | 后端项目设置、目录结构、依赖配置        | 阶段一 |
| **[12-rss-migration-to-fastapi.md](./12-rss-migration-to-fastapi.md)** | RSS 任务迁移到 Celery、任务逻辑移植 | 阶段一 |
| **[13-chat-implementation.md](./13-chat-implementation.md)**       | Chat 功能实现、Langchain 集成、流式响应 | 阶段二 |
| **[14-frontend-integration.md](./14-frontend-integration.md)**     | 前端集成、移除 BullMQ、添加 Chat 路由   | 两阶段 |

## 核心决策

- **目录结构**: 使用 `backend/` 目录（与参考项目一致）
- **包管理**: Poetry（`pyproject.toml`）
- **前后端通信**: Next.js Rewrites（统一转发，无 CORS 问题）
- **消息队列**: Celery + Redis（替代 BullMQ）
- **认证方式**: Supabase JWT via `supabase.auth.get_user(token)`
- **数据库**: SQLAlchemy ORM + Supabase PostgreSQL
- **Chat 设计**: 无状态流式对话（不存储聊天记录），复用现有 `api_configs` 表配置
- **流式响应**: Vercel AI SDK Data Stream Protocol (`0:"{chunk}"\n`)
- **向量数据库**: Supabase pgvector（用于 RAG 语义搜索）

## 参考项目架构

参考项目 `nextjs-starter-template/backend` 采用清晰的三层架构：

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI 应用入口
│   ├── database.py             # SQLAlchemy 数据库配置
│   ├── dependencies.py         # JWT 验证依赖
│   │
│   ├── api/
│   │   └── routers/
│   │       └── chat.py         # Chat CRUD 端点
│   │
│   ├── models/
│   │   ├── profile.py          # Profile ORM 模型
│   │   ├── chat_session.py     # ChatSession ORM 模型
│   │   └── message.py          # Message ORM 模型
│   │
│   ├── schemas/
│   │   └── chat.py             # Pydantic 请求/响应模型
│   │
│   └── services/
│       └── chat_service.py     # LLM 流式处理逻辑
│
├── pyproject.toml              # Poetry 依赖配置
└── README.md                   # 文档
```

### 关键设计模式

1. **三层架构**: Router → Service → Database
   - Router 层处理 HTTP 请求/响应
   - Service 层包含业务逻辑
   - Database 层管理数据持久化

2. **依赖注入**: FastAPI `Depends()` 用于认证和数据库会话
   ```python
   async def verify_jwt(credentials = Depends(security)):
       user = supabase.auth.get_user(token)
       return user
   ```

3. **流式响应**: Vercel AI SDK 兼容格式
   ```python
   yield f'0:"{chunk}"\n'  # 文本块格式
   ```

4. **用户数据隔离**: 所有查询包含 `user_id` 过滤

## 实施阶段

### 阶段一：RSS 迁移

- FastAPI 项目骨架（参考 nextjs-starter-template 结构）
- Celery + Redis 消息队列
- RSS Feed 刷新任务迁移
- 前端集成 + 移除 BullMQ

### 阶段二：Chat 功能

- Chat API 端点（无状态，不存储聊天记录）
- Langchain + 流式响应
- Chat UI 页面 (`/chat` 路由）

### 阶段三：RAG 语义搜索（可选）

- pgvector 扩展启用
- 文章 embedding 生成
- 语义搜索 API

---

## 架构设计

```
Frontend (Next.js :3000)
        |
        v
+------------------+     +------------------+
| Next.js Rewrites |     | 现有 API         |
| /api/backend/*   |     | /api/rss/*       |
| (自动转发)       |     | /api/scheduler/* |
+--------+---------+     +------------------+
         |
         | HTTP (自动 rewrite 到 localhost:8000)
         v
+------------------+
| FastAPI :8000    |
| /api/rss/*       |
| /api/chat/*      |
| /api/search/*    |
| /api/embeddings/*|
+--------+---------+
         |
    +----+----+
    |         |
    v         v
+-------+  +------------------+
|Celery |  | Supabase         |
|Worker |->| PostgreSQL       |
+-------+  | + pgvector       |
    |      +------------------+
    v
+-------+
| Redis |  (共享: BullMQ + Celery)
+-------+
```

**Next.js Rewrites 优势**：

- **无 CORS 问题**：前后端同域，浏览器视角下所有请求都发往 :3000
- **流式响应稳定**：SSE/WebSocket 自动转发，无需额外配置
- **配置集中**：一处 `next.config.js` 管理所有转发规则
- **认证简化**：前端统一添加 JWT header，后端统一验证

**端口分配**：

| 服务           | 端口 | 用途                |
| -------------- | ---- | ------------------- |
| Next.js        | 3000 | 前端 + API 代理     |
| FastAPI        | 8000 | 后端 API            |
| Celery Worker  | -    | 异步任务处理        |
| Bull Dashboard | 3001 | BullMQ 队列监控     |
| Flower         | 5555 | Celery 队列监控     |

---

## 目录结构

采用参考项目的目录结构，扩展支持 RSS 和语义搜索：

```
SaveHub_Supabase/
├── next.config.js           # 新增 rewrites 配置
├── app/api/
│   ├── rss/                 # 现有（不变）
│   └── scheduler/           # 现有（不变）
│   # 注意：无需创建代理层文件，rewrites 自动转发
│
├── backend/                 # 新增: FastAPI 项目 (参考 nextjs-starter-template)
│   ├── pyproject.toml       # Poetry 依赖配置
│   ├── poetry.lock          # Poetry 锁文件
│   ├── README.md            # 后端文档
│   │
│   └── app/
│       ├── __init__.py
│       ├── main.py              # FastAPI 入口
│       ├── database.py          # SQLAlchemy 配置
│       ├── dependencies.py      # JWT 验证 (Supabase)
│       │
│       ├── api/
│       │   ├── __init__.py
│       │   └── routers/
│       │       ├── __init__.py
│       │       ├── rss.py       # RSS 调度端点
│       │       ├── chat.py      # Chat 端点
│       │       ├── search.py    # 语义搜索端点
│       │       └── embeddings.py # Embedding 管理端点
│       │
│       ├── models/
│       │   ├── __init__.py
│       │   ├── profile.py       # Profile ORM 模型
│       │   ├── feed.py          # Feed ORM 模型 (可选)
│       │   └── article.py       # Article ORM 模型 (可选)
│       │
│       ├── schemas/
│       │   ├── __init__.py
│       │   ├── rss.py           # RSS Pydantic schemas
│       │   └── chat.py          # Chat Pydantic schemas
│       │
│       ├── services/
│       │   ├── __init__.py
│       │   ├── chat_service.py      # LLM 流式处理
│       │   ├── embedding_service.py # Embedding 生成
│       │   ├── encryption_service.py # 解密 api_configs
│       │   └── vector_store.py      # pgvector 操作
│       │
│       ├── tasks/
│       │   ├── __init__.py
│       │   ├── rss_tasks.py         # RSS Celery 任务
│       │   └── embedding_tasks.py   # Embedding Celery 任务
│       │
│       └── core/
│           ├── __init__.py
│           ├── celery_app.py        # Celery 配置
│           └── config.py            # Pydantic Settings
│
└── lib/api/                 # 新增：前端 API 客户端
    └── backend.ts           # FastAPI 调用封装
```

---

## 核心文件示例

### 1. FastAPI 入口 (`backend/app/main.py`)

参考 `nextjs-starter-template/backend/app/main.py`:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from app.api.routers import rss, chat, search, embeddings
from app.database import create_tables

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时创建表
    create_tables()
    print("FastAPI server starting...")
    yield
    print("FastAPI server shutting down...")

app = FastAPI(
    title="SaveHub Backend API",
    description="FastAPI backend for RSS Reader with Chat and RAG",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 配置 (主要用于直接访问 /docs 测试)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(rss.router, prefix="/api/rss", tags=["RSS"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(search.router, prefix="/api/search", tags=["Search"])
app.include_router(embeddings.router, prefix="/api/embeddings", tags=["Embeddings"])

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "savehub-backend"}
```

### 2. 数据库配置 (`backend/app/database.py`)

参考 `nextjs-starter-template/backend/app/database.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    """数据库会话依赖"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_tables():
    """创建所有表"""
    Base.metadata.create_all(bind=engine)
```

### 3. JWT 验证 (`backend/app/dependencies.py`)

参考 `nextjs-starter-template/backend/app/dependencies.py` - 使用 Supabase 验证:

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
import os

security = HTTPBearer()

# Supabase 客户端单例
_supabase: Client | None = None

def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_ANON_KEY")
        )
    return _supabase

def verify_jwt(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    验证 Supabase JWT token。

    使用 Supabase 服务端验证，而非本地 JWT 解码。
    """
    token = credentials.credentials

    try:
        supabase = get_supabase()
        response = supabase.auth.get_user(token)

        if not response or not response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token"
            )

        return response.user

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}"
        )
```

### 4. Next.js Rewrites 配置 (`next.config.js`)

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const fastApiUrl = process.env.NODE_ENV === "development"
      ? "http://127.0.0.1:8000"
      : process.env.FASTAPI_URL || "http://127.0.0.1:8000"

    return [
      {
        source: "/api/backend/:path*",
        destination: `${fastApiUrl}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
```

---

## Python 依赖 (`backend/pyproject.toml`)

使用 Poetry 管理依赖（参考 nextjs-starter-template）:

```toml
[tool.poetry]
name = "savehub-backend"
version = "0.1.0"
description = "FastAPI backend for SaveHub RSS Reader"
authors = ["Your Name"]
readme = "README.md"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.112.0"
uvicorn = {extras = ["standard"], version = "^0.30.0"}
pydantic = "^2.8.0"
pydantic-settings = "^2.4.0"
python-dotenv = "^1.0.1"
sqlalchemy = "^2.0.32"
psycopg2-binary = "^2.9.9"
supabase = "^2.7.0"
openai = "^1.41.0"
langchain = "^0.2.14"
langchain-openai = "^0.1.22"
httpx = "^0.27.0"
celery = {extras = ["redis"], version = "^5.4.0"}
redis = "^5.0.0"
feedparser = "^6.0.11"
cryptography = "^43.0.0"
pgvector = "^0.3.0"
psycopg = {extras = ["binary"], version = "^3.2.0"}

[tool.poetry.group.dev.dependencies]
pytest = "^8.0.0"
pytest-asyncio = "^0.23.0"
ruff = "^0.5.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

---

## 开发命令

### package.json 更新

```json
{
  "scripts": {
    "dev": "next dev",
    "dev:all": "concurrently -n next,fastapi,celery -c blue,yellow,green \"pnpm dev\" \"pnpm fastapi:dev\" \"pnpm celery:dev\"",
    "fastapi:dev": "cd backend && poetry run uvicorn app.main:app --reload --port 8000",
    "fastapi:install": "cd backend && poetry install",
    "celery:dev": "cd backend && poetry run celery -A app.tasks.rss_tasks worker --loglevel=info",
    "celery:flower": "cd backend && poetry run celery -A app.tasks.rss_tasks flower --port=5555"
  }
}
```

### Poetry 安装与初始化

```bash
# 安装 Poetry（如果未安装）
# Windows (PowerShell)
(Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | py -

# macOS/Linux
curl -sSL https://install.python-poetry.org | python3 -

# 初始化 Python 项目
cd backend
poetry install  # 安装依赖
poetry shell    # 进入虚拟环境
```

### .env 配置

```bash
# Supabase
SUPABASE_URL=https://[PROJECT-REF].supabase.co
SUPABASE_ANON_KEY=eyJ...

# 数据库直连 URL
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres

# Redis (Celery)
REDIS_URL=redis://localhost:6379/0

# 加密密钥 (必须与 Next.js ENCRYPTION_SECRET 一致)
ENCRYPTION_SECRET=your-32-character-secret-key-here
```

---

## 实施步骤

| 步骤 | 任务                                       | 产出                                |
| ---- | ------------------------------------------ | ----------------------------------- |
| 1    | 创建 `backend/` 目录结构，使用 Poetry 初始化 | `pyproject.toml`, `poetry.lock`    |
| 2    | 实现 FastAPI 入口和配置                    | `main.py`, `database.py`, `dependencies.py` |
| 3    | 实现核心服务（加密、认证）                 | `services/*.py`                    |
| 4    | 实现 RSS Celery 任务                       | `tasks/rss_tasks.py`               |
| 5    | 实现 RSS API 路由                          | `api/routers/rss.py`               |
| 6    | 实现 Chat 服务（无状态流式对话）           | `services/chat_service.py`         |
| 7    | 实现 Chat API 路由                         | `api/routers/chat.py`              |
| 8    | **配置 Next.js Rewrites**                  | `next.config.js` 添加 rewrites     |
| 9    | 创建前端 API 客户端                        | `lib/api/backend.ts`               |
| 10   | 更新 `package.json` 启动脚本               | `dev:all` 包含 FastAPI + Celery    |

---

## 关键文件清单

| 文件                                 | 用途                                    | 优先级 |
| ------------------------------------ | --------------------------------------- | ------ |
| `next.config.js`                     | **添加 rewrites 配置**（核心）          | P0     |
| `backend/pyproject.toml`             | Poetry 依赖配置                         | P0     |
| `backend/app/main.py`                | FastAPI 入口                            | P0     |
| `backend/app/database.py`            | SQLAlchemy 配置                         | P0     |
| `backend/app/dependencies.py`        | Supabase JWT 验证                       | P0     |
| `backend/app/services/encryption_service.py` | 解密 api_configs                  | P0     |
| `backend/app/services/chat_service.py` | LLM 无状态流式处理（不存储聊天记录）  | P0     |
| `backend/app/api/routers/rss.py`     | RSS 调度 API                            | P0     |
| `backend/app/api/routers/chat.py`    | Chat API（无状态）                      | P1     |
| `backend/app/tasks/rss_tasks.py`     | RSS Celery 任务                         | P0     |
| `lib/api/backend.ts`                 | 前端 API 客户端                         | P1     |

---

## 注意事项

### 认证方式

使用 Supabase 服务端验证（参考项目模式），而非本地 JWT 解码：

```python
# ✅ 推荐：Supabase 服务端验证
supabase.auth.get_user(token)

# ❌ 不推荐：本地 JWT 解码
jose.jwt.decode(token, secret, algorithms=["HS256"])
```

**原因**：
- Supabase 验证更安全，处理 token 刷新和撤销
- 与参考项目保持一致
- 减少配置复杂度

### 加密兼容性

`backend/app/services/encryption_service.py` **必须**与 `lib/encryption.ts` 完全兼容：

- 相同的 SALT: `"rssreader-salt"`
- 相同的 ITERATIONS: `100000`
- 相同的 IV_LENGTH: `12`
- 相同的密钥派生方式

### 目录结构

使用 `backend/` 而非 `fastapi/`，与参考项目保持一致：

```bash
# ✅ 推荐
backend/app/main.py

# ❌ 不推荐
fastapi/app/main.py
```
