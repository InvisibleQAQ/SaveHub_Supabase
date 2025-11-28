# FastAPI 后端项目设置

## 概述

本文档详细说明如何在 RSS Reader 项目中设置 FastAPI 后端，用于替代 BullMQ 实现 RSS 任务调度，并为 Chat 功能提供支持。

> **📝 Chat 设计**: Chat 功能采用无状态设计，不存储聊天记录到数据库。每次对话仅通过流式响应返回，历史消息由前端 Context 管理。

**参考项目**: `reference_repository/nextjs-starter-template/backend` - 本设置完全遵循参考项目的架构模式。

## 目录结构

采用参考项目的三层架构（Router → Service → Database）：

```
SaveHub_Supabase/
├── (现有 Next.js 文件)
├── app/                    # 现有 Next.js app 目录
├── lib/                    # 现有 TypeScript 库
├── components/             # 现有 React 组件
│
└── backend/               # 新增: FastAPI 项目 (参考 nextjs-starter-template)
    ├── pyproject.toml     # Poetry 依赖配置
    ├── poetry.lock        # Poetry 锁文件
    ├── README.md          # 后端说明
    ├── .env.example       # 环境变量示例
    │
    └── app/
        ├── __init__.py
        ├── main.py            # FastAPI 应用入口
        ├── database.py        # SQLAlchemy 数据库配置
        ├── dependencies.py    # JWT 验证依赖 (Supabase)
        │
        ├── api/
        │   ├── __init__.py
        │   └── routers/
        │       ├── __init__.py
        │       ├── rss.py     # RSS 调度端点
        │       └── chat.py    # Chat 端点 (阶段二)
        │
        ├── models/
        │   ├── __init__.py    # 导出所有模型
        │   └── profile.py     # Profile ORM 模型
        │
        ├── schemas/
        │   ├── __init__.py
        │   ├── rss.py         # RSS Pydantic schemas
        │   └── chat.py        # Chat schemas (阶段二)
        │
        ├── services/
        │   ├── __init__.py
        │   ├── encryption_service.py  # 加密服务
        │   └── chat_service.py        # Chat 服务 (阶段二)
        │
        ├── tasks/
        │   ├── __init__.py
        │   └── rss_tasks.py   # Celery RSS 刷新任务
        │
        └── core/
            ├── __init__.py
            └── celery_app.py  # Celery 配置
```

---

## 第一步：创建目录结构

```bash
# 在 SaveHub_Supabase 目录下执行
mkdir -p backend/app/{api/routers,models,schemas,services,tasks,core}

# 创建 __init__.py 文件
touch backend/app/__init__.py
touch backend/app/api/__init__.py
touch backend/app/api/routers/__init__.py
touch backend/app/models/__init__.py
touch backend/app/schemas/__init__.py
touch backend/app/services/__init__.py
touch backend/app/tasks/__init__.py
touch backend/app/core/__init__.py
```

---

## 第二步：创建 pyproject.toml (Poetry)

使用 Poetry 管理依赖（参考 `nextjs-starter-template/backend/pyproject.toml`）：

```toml
# backend/pyproject.toml

[tool.poetry]
name = "savehub-backend"
version = "0.1.0"
description = "FastAPI backend for SaveHub RSS Reader"
authors = ["Your Name"]
readme = "README.md"

[tool.poetry.dependencies]
python = "^3.11"

# FastAPI 核心
fastapi = "^0.112.0"
uvicorn = {extras = ["standard"], version = "^0.30.0"}
pydantic = "^2.8.0"
pydantic-settings = "^2.4.0"
python-dotenv = "^1.0.1"

# 数据库
sqlalchemy = "^2.0.32"
psycopg2-binary = "^2.9.9"

# Supabase
supabase = "^2.7.0"

# Celery + Redis
celery = {extras = ["redis"], version = "^5.4.0"}
redis = "^5.0.0"

# RSS 解析
feedparser = "^6.0.11"
httpx = "^0.27.0"

# LLM / Chat (阶段二)
langchain = "^0.2.14"
langchain-openai = "^0.1.22"
openai = "^1.41.0"

# 加密
cryptography = "^43.0.0"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0.0"
pytest-asyncio = "^0.23.0"
ruff = "^0.5.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

---

## 第三步：数据库配置 (database.py)

参考 `nextjs-starter-template/backend/app/database.py`:

```python
# backend/app/database.py

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

# 从环境变量获取数据库连接字符串
DATABASE_URL = os.getenv("DATABASE_URL")

# 创建数据库引擎
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

# 创建会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 声明基类
Base = declarative_base()


def get_db():
    """
    数据库会话依赖。
    用法: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    """创建所有表（从 ORM 模型）"""
    Base.metadata.create_all(bind=engine)
```

---

## 第四步：JWT 验证依赖 (dependencies.py)

参考 `nextjs-starter-template/backend/app/dependencies.py` - 使用 Supabase 服务端验证：

```python
# backend/app/dependencies.py

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client, Client
import os

# HTTP Bearer 安全方案
security = HTTPBearer()

# Supabase 客户端单例
_supabase_client: Client | None = None
_supabase_admin_client: Client | None = None


def get_supabase_client() -> Client:
    """获取 Supabase 客户端单例 (anon key)"""
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_ANON_KEY")
        )
    return _supabase_client


def get_supabase_admin_client() -> Client:
    """获取 Supabase 管理员客户端单例 (service role key)"""
    global _supabase_admin_client
    if _supabase_admin_client is None:
        _supabase_admin_client = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        )
    return _supabase_admin_client


def verify_jwt(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """
    验证 Supabase JWT token。

    使用 Supabase 服务端验证（参考项目模式），而非本地 JWT 解码。

    用法:
        @router.get("/protected")
        async def protected_route(user = Depends(verify_jwt)):
            user_id = str(user.id)
    """
    token = credentials.credentials

    try:
        supabase = get_supabase_client()
        response = supabase.auth.get_user(token)

        if not response or not response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token"
            )

        return response.user

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}"
        )


def get_user_id(user = Depends(verify_jwt)) -> str:
    """
    便捷依赖：直接获取 user_id。

    用法:
        @router.get("/my-feeds")
        async def my_feeds(user_id: str = Depends(get_user_id)):
            ...
    """
    return str(user.id)
```

---

## 第五步：加密服务 (encryption_service.py)

**关键**: 必须与 `lib/encryption.ts` 完全兼容。

```python
# backend/app/services/encryption_service.py

import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

# 常量 - 必须与 lib/encryption.ts 完全一致
SALT = b"rssreader-salt"  # 固定盐值 (与 TypeScript 一致)
ITERATIONS = 100000       # PBKDF2 迭代次数
KEY_LENGTH = 32           # AES-256 密钥长度
IV_LENGTH = 12            # GCM IV 长度
TAG_LENGTH = 16           # GCM tag 长度


def _derive_key(secret: str) -> bytes:
    """
    使用 PBKDF2 派生 AES 密钥。
    必须与 lib/encryption.ts 中的 deriveKey() 完全一致。
    """
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KEY_LENGTH,
        salt=SALT,
        iterations=ITERATIONS,
    )
    return kdf.derive(secret.encode("utf-8"))


def encrypt(plaintext: str) -> str:
    """
    使用 AES-256-GCM 加密字符串。

    输出格式: base64(iv + ciphertext + tag)
    """
    if not plaintext:
        return ""

    encryption_secret = os.getenv("ENCRYPTION_SECRET")
    if not encryption_secret:
        raise ValueError("ENCRYPTION_SECRET not configured")

    key = _derive_key(encryption_secret)
    iv = os.urandom(IV_LENGTH)
    aesgcm = AESGCM(key)

    # 加密 (AESGCM 自动附加 tag)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)

    # 组合: iv + ciphertext (包含 tag)
    combined = iv + ciphertext

    return base64.b64encode(combined).decode("utf-8")


def decrypt(encrypted_data: str) -> str:
    """
    解密由 lib/encryption.ts 或本服务加密的数据。

    输入格式: base64(iv + ciphertext + tag)
    """
    if not encrypted_data:
        return ""

    encryption_secret = os.getenv("ENCRYPTION_SECRET")
    if not encryption_secret:
        raise ValueError("ENCRYPTION_SECRET not configured")

    try:
        key = _derive_key(encryption_secret)

        # 解码 base64
        combined = base64.b64decode(encrypted_data)

        # 分离 IV 和密文
        iv = combined[:IV_LENGTH]
        ciphertext = combined[IV_LENGTH:]

        # 解密
        aesgcm = AESGCM(key)
        plaintext = aesgcm.decrypt(iv, ciphertext, None)

        return plaintext.decode("utf-8")

    except Exception as e:
        raise ValueError(f"Decryption failed: {str(e)}")


def is_encrypted(data: str) -> bool:
    """
    检查字符串是否看起来像是加密数据。

    简单启发式检查：
    - 是有效的 base64
    - 长度足够包含 IV + tag
    """
    if not data:
        return False

    try:
        decoded = base64.b64decode(data)
        # 最小长度 = IV(12) + TAG(16) = 28
        return len(decoded) >= IV_LENGTH + TAG_LENGTH
    except Exception:
        return False
```

---

## 第六步：FastAPI 主应用 (main.py)

参考 `nextjs-starter-template/backend/app/main.py`:

```python
# backend/app/main.py

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

from app.api.routers import rss
# from app.api.routers import chat  # 阶段二启用
from app.database import create_tables


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时创建表
    create_tables()
    print("FastAPI server starting...")
    yield
    # 关闭时执行
    print("FastAPI server shutting down...")


app = FastAPI(
    title="SaveHub Backend API",
    description="FastAPI backend for RSS Reader with Celery task queue",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 配置
# 注意：使用 Next.js Rewrites 后，前端请求通过 :3000 转发，
# 浏览器视角下是同域请求，因此 CORS 配置可以简化。
# 保留此配置主要用于：
# 1. 直接访问 FastAPI 文档 (/docs) 时的测试
# 2. 开发调试时绕过 Next.js 直接测试 API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Next.js 开发服务器
        "http://127.0.0.1:3000",  # 备用
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(rss.router, prefix="/api/rss", tags=["RSS"])
# app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])  # 阶段二


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "healthy", "service": "savehub-backend"}


@app.get("/")
async def root():
    """根路径"""
    return {
        "message": "SaveHub Backend API",
        "docs": "/docs",
        "health": "/health"
    }
```

> **💡 关于 CORS**：由于前端通过 Next.js Rewrites (`/api/backend/*` → FastAPI) 访问后端，
> 浏览器视角下所有请求都发往 `localhost:3000`，属于同域请求，因此 **无需担心 CORS 问题**。
> 上述 CORS 配置仅用于开发调试时直接访问 FastAPI。

---

## 第七步：ORM 模型 (models/)

参考 `nextjs-starter-template/backend/app/models/`:

> **📝 Note**: Chat 功能采用无状态设计，不需要 ChatSession 和 Message 模型。聊天历史由前端 Context 管理。

### Profile 模型

```python
# backend/app/models/profile.py

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Profile(Base):
    """
    用户资料模型。
    关联 Supabase auth.users 表。
    """
    __tablename__ = "profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
```

### 模型导出

```python
# backend/app/models/__init__.py

from app.models.profile import Profile

__all__ = ["Profile"]
```

---

## 第八步：环境变量示例 (.env.example)

```bash
# backend/.env.example

# ============================================
# 数据库配置
# ============================================
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# ============================================
# Supabase 配置
# ============================================
SUPABASE_URL=https://[PROJECT-REF].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# ============================================
# Redis 配置 (Celery broker)
# ============================================
REDIS_URL=redis://localhost:6379/0

# ============================================
# 加密配置
# 重要: 必须与 Next.js 的 ENCRYPTION_SECRET 完全一致！
# ============================================
ENCRYPTION_SECRET=your-32-character-secret-key-here

# ============================================
# OpenAI (Chat 功能)
# ============================================
OPENAI_API_KEY=sk-...
```

---

## 第九步：启动后端

### 安装 Poetry

```bash
# Windows (PowerShell)
(Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | py -

# macOS/Linux
curl -sSL https://install.python-poetry.org | python3 -
```

### 安装依赖

```bash
cd backend
poetry install
```

### 创建 .env 文件

```bash
cp .env.example .env
# 编辑 .env 填入实际值
```

### 启动 FastAPI 服务器

```bash
# 进入虚拟环境
poetry shell

# 开发模式 (热重载)
uvicorn app.main:app --reload --port 8000

# 或直接使用 poetry run
poetry run uvicorn app.main:app --reload --port 8000
```

### 验证服务

```bash
# 健康检查
curl http://localhost:8000/health

# 查看 API 文档
# 浏览器打开: http://localhost:8000/docs
```

---

## 下一步

后端基础架构设置完成后，继续以下文档：

1. **[12-rss-migration-to-fastapi.md](./12-rss-migration-to-fastapi.md)** - RSS 任务迁移到 Celery
2. **[13-chat-implementation.md](./13-chat-implementation.md)** - Chat 功能实现
3. **[14-frontend-integration.md](./14-frontend-integration.md)** - 前端集成

---

## 关键注意事项

### 1. 认证方式

使用 Supabase 服务端验证（参考项目模式）：

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

### 2. 加密兼容性

`encryption_service.py` **必须**与 `lib/encryption.ts` 完全兼容：
- 相同的 SALT: `b"rssreader-salt"`
- 相同的 ITERATIONS: `100000`
- 相同的 IV_LENGTH: `12`
- 相同的密钥派生方式 (PBKDF2-SHA256)

**测试方法**:
1. 在 Next.js 中加密一个字符串
2. 在 Python 中解密该字符串
3. 验证结果一致

### 3. 环境变量同步

以下环境变量必须在 Next.js 和 FastAPI 中保持一致：
- `ENCRYPTION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### 4. 数据库连接

- 使用 Supabase 提供的 PostgreSQL 连接字符串
- 确保允许从本地 IP 访问（Supabase Dashboard > Settings > Database > Connection Pooling）

### 5. 端口分配

| 服务 | 端口 |
|------|------|
| Next.js | 3000 |
| FastAPI | 8000 |
| Redis | 6379 |
| Celery Worker | - |
| Flower (可选) | 5555 |

### 6. 目录结构

使用 `backend/` 而非 `fastapi/`，与参考项目保持一致：

```bash
# ✅ 推荐
backend/app/main.py

# ❌ 不推荐
fastapi/app/main.py
```
