# FastAPI 后端环境搭建指南

## 前置要求

- Python 3.10+
- Poetry（Python 包管理器）
- Redis Server
- 已配置的 Supabase 项目

## 现有后端结构

项目中已存在 FastAPI 后端，位于 `backend/` 目录：

```
backend/
├── app/
│   ├── api/routers/chat.py      # 聊天功能 API
│   ├── models/                   # SQLAlchemy 模型
│   ├── schemas/chat.py          # Pydantic schemas
│   ├── services/chat_service.py # LLM 服务
│   ├── database.py              # 数据库连接
│   ├── dependencies.py          # JWT 验证
│   └── main.py                  # FastAPI 应用入口
├── pyproject.toml               # Poetry 依赖配置
├── Dockerfile
└── .env.example
```

## 环境配置

### 1. 安装依赖

```bash
cd backend
poetry install
```

### 2. 添加新依赖

修改 `pyproject.toml`，添加 RSS 和 Celery 相关依赖：

```toml
[tool.poetry.dependencies]
python = "^3.10"
# 现有依赖...
fastapi = "^0.112.1"
uvicorn = "^0.30.6"
sqlalchemy = "^2.0.32"
supabase = "^2.7.2"
langchain = "^0.2.14"
langchain-openai = "^0.1.22"
pydantic = "^2.8.2"
python-dotenv = "^1.0.1"
psycopg2-binary = "^2.9.9"
httpx = "^0.27.0"

# 新增依赖
feedparser = "^6.0.0"          # RSS 解析
celery = {extras = ["redis"], version = "^5.3.0"}  # 任务队列
redis = "^5.0.0"               # Redis 客户端
```

安装新依赖：

```bash
poetry add feedparser "celery[redis]" redis
```

### 3. 环境变量配置

更新 `.env` 文件：

```env
# Supabase 配置（现有）
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# OpenAI 配置（现有）
OPENAI_API_KEY=your-openai-key

# Redis 配置（新增）
REDIS_URL=redis://localhost:6379/0

# Celery 配置（新增）
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

## 数据库模型

### Feed 模型

创建 `backend/app/models/feed.py`：

```python
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base
import uuid

class Feed(Base):
    __tablename__ = "feeds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    title = Column(Text, nullable=False)
    url = Column(Text, nullable=False)
    description = Column(Text)
    category = Column(Text)
    folder_id = Column(UUID(as_uuid=True), ForeignKey("folders.id", ondelete="SET NULL"))
    order = Column(Integer, default=0)
    unread_count = Column(Integer, default=0)
    refresh_interval = Column(Integer, default=60)  # 分钟
    last_fetched = Column(DateTime(timezone=True))
    last_fetch_status = Column(Text)  # 'success' | 'failed' | null
    last_fetch_error = Column(Text)
    enable_deduplication = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

### Article 模型

创建 `backend/app/models/article.py`：

```python
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base
import uuid

class Article(Base):
    __tablename__ = "articles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    feed_id = Column(UUID(as_uuid=True), ForeignKey("feeds.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    summary = Column(Text)
    url = Column(Text, nullable=False)
    author = Column(Text)
    published_at = Column(DateTime(timezone=True), nullable=False)
    is_read = Column(Boolean, default=False)
    is_starred = Column(Boolean, default=False)
    thumbnail = Column(Text)
    content_hash = Column(Text)  # SHA-256 用于去重
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

### 更新模型导出

修改 `backend/app/models/__init__.py`：

```python
from app.models.profile import Profile
from app.models.chat_session import ChatSession
from app.models.message import Message
from app.models.feed import Feed
from app.models.article import Article

__all__ = ["Profile", "ChatSession", "Message", "Feed", "Article"]
```

## Pydantic Schemas

### RSS Schemas

创建 `backend/app/schemas/rss.py`：

```python
from pydantic import BaseModel, HttpUrl, Field
from typing import Optional, List
from datetime import datetime
from uuid import UUID

# 请求模型
class ValidateRequest(BaseModel):
    url: HttpUrl

class ParseRequest(BaseModel):
    url: HttpUrl
    feedId: UUID  # 注意：使用 camelCase 匹配前端

# 响应模型
class ValidateResponse(BaseModel):
    valid: bool

class ParsedFeed(BaseModel):
    title: str
    description: str
    link: str
    image: Optional[str] = None

class ParsedArticle(BaseModel):
    id: UUID
    feedId: UUID
    title: str
    content: str
    summary: str
    url: str
    author: Optional[str] = None
    publishedAt: datetime
    isRead: bool = False
    isStarred: bool = False
    thumbnail: Optional[str] = None

class ParseResponse(BaseModel):
    feed: ParsedFeed
    articles: List[ParsedArticle]
```

### Scheduler Schemas

创建 `backend/app/schemas/scheduler.py`：

```python
from pydantic import BaseModel
from typing import Optional
from uuid import UUID

class FeedScheduleInfo(BaseModel):
    id: UUID
    url: str
    title: str
    refreshInterval: int
    lastFetched: Optional[str] = None

class ScheduleRequest(BaseModel):
    feed: FeedScheduleInfo
    forceImmediate: bool = False

class ScheduleResponse(BaseModel):
    success: bool
    delaySeconds: int
    priority: str

class CancelRequest(BaseModel):
    feedId: UUID

class CancelResponse(BaseModel):
    success: bool
```

## 运行服务

### 启动 FastAPI 开发服务器

```bash
cd backend
poetry run uvicorn app.main:app --reload --port 8000
```

### 启动 Redis

```bash
# macOS (Homebrew)
brew services start redis

# Linux (systemd)
sudo systemctl start redis

# Windows (使用 WSL 或 Docker)
docker run -d -p 6379:6379 redis:alpine
```

### 验证服务状态

```bash
# 检查 FastAPI
curl http://localhost:8000/docs

# 检查 Redis
redis-cli ping
# 应返回: PONG
```

## 开发命令

### Poetry 常用命令

```bash
# 安装所有依赖
poetry install

# 添加新依赖
poetry add package_name

# 添加开发依赖
poetry add --group dev pytest

# 激活虚拟环境
poetry shell

# 运行脚本
poetry run python script.py
```

### 数据库相关

```bash
# 使用 Supabase CLI 生成类型（可选）
supabase gen types typescript --project-id your-project-id > lib/supabase/types.ts
```

## 常见问题

### 1. Poetry 安装失败

```bash
# 更新 pip
pip install --upgrade pip

# 清除缓存重试
poetry cache clear --all pypi
poetry install
```

### 2. Redis 连接失败

```bash
# 检查 Redis 是否运行
redis-cli ping

# 检查端口占用
lsof -i :6379
```

### 3. 数据库连接失败

确保 `.env` 中的 `DATABASE_URL` 格式正确：
```
postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

### 4. Supabase JWT 验证失败

检查 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 是否与前端配置一致。

## 下一步

完成环境搭建后，继续阅读：
- [RSS 功能迁移详细步骤](./12-rss-migration-to-fastapi.md)
