# FastAPI 后端环境搭建指南

## 前置要求

- Python 3.10+（推荐使用 **Miniconda**）
- pip（Python 包管理器）
- Redis Server（用于 Celery 后台任务，可选）
- 已配置的 Supabase 项目

## 核心架构

本项目使用 **Supabase Python SDK** 访问数据库，**不使用 SQLAlchemy**。

| 特性 | 本项目方案 | 说明 |
|-----|-----------|------|
| 数据库访问 | Supabase Python SDK | HTTPS API，与前端一致 |
| ORM | 无 | 不使用 SQLAlchemy |
| 类型安全 | Pydantic 模型 | 强类型请求/响应验证 |
| 连接方式 | HTTPS | 非直连 PostgreSQL |

## 后端结构

```
backend/
├── app/
│   ├── api/routers/
│   │   └── rss.py               # RSS 解析 API
│   ├── schemas/
│   │   └── rss.py               # Pydantic 模型（请求/响应）
│   ├── services/
│   │   └── rss_parser.py        # feedparser 封装
│   ├── supabase_client.py       # Supabase 客户端
│   ├── dependencies.py          # JWT 验证
│   └── main.py                  # FastAPI 应用入口
├── requirements.txt             # pip 依赖配置
├── Dockerfile
└── .env
```

## 环境配置

### 1. Python 环境

推荐使用 **Miniconda base 环境**（无需创建虚拟环境）：

```bash
cd backend

# 确认 Miniconda 已激活（命令行应显示 (base)）
conda --version
python --version  # 应为 3.10+
```

如果需要创建独立环境（可选）：

```bash
# 创建独立 conda 环境
conda create -n savehub python=3.11
conda activate savehub
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. requirements.txt 内容

创建或更新 `backend/requirements.txt`：

```txt
# Web 框架
fastapi>=0.112.1
uvicorn>=0.30.6

# Supabase（数据库访问 + 认证）
supabase>=2.7.2

# LLM
langchain>=0.2.14
langchain-openai>=0.1.22

# 数据验证
pydantic>=2.8.2

# 工具
python-dotenv>=1.0.1
httpx>=0.27.0

# RSS 解析
feedparser>=6.0.0

# 任务队列
celery[redis]>=5.3.0
redis>=5.0.0
```

安装新依赖（如果已有 requirements.txt）：

```bash
pip install feedparser "celery[redis]" redis
# 或者更新 requirements.txt 后重新安装
pip install -r requirements.txt
```

### 4. 环境变量配置

更新 `.env` 文件：

```env
# Supabase 配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # 用于后台任务（绕过 RLS）

# OpenAI 配置（现有）
OPENAI_API_KEY=your-openai-key

# Redis 配置（新增）
REDIS_URL=redis://localhost:6379/0

# Celery 配置（新增）
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

**Key 使用场景**:

- `SUPABASE_ANON_KEY`: API 请求（RLS 生效，需要 JWT）
- `SUPABASE_SERVICE_ROLE_KEY`: Celery 后台任务（绕过 RLS）

## Supabase 客户端配置

### 创建 Supabase 客户端

创建 `backend/app/supabase_client.py`：

```python
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def get_supabase_client(access_token: str | None = None) -> Client:
    """
    获取 Supabase 客户端
    - 带 access_token: 用于 API 请求（RLS 生效）
    - 不带 token: 使用 anon key（需要 JWT header）
    """
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    if access_token:
        client.auth.set_session(access_token, "")
    return client

def get_service_client() -> Client:
    """
    获取 Service Role 客户端（绕过 RLS）
    仅用于后台任务（Celery workers）
    """
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
```

## Pydantic 数据模型

使用 Pydantic 模型定义数据结构，提供类型安全和自动验证。

### Feed 模型

创建 `backend/app/schemas/feed.py`：

```python
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID

class FeedBase(BaseModel):
    title: str
    url: str
    description: Optional[str] = None
    category: Optional[str] = None
    folder_id: Optional[UUID] = None
    order: int = 0
    refresh_interval: int = 60  # 分钟

class FeedCreate(FeedBase):
    """创建 Feed 的请求模型"""
    pass

class FeedUpdate(BaseModel):
    """更新 Feed 的请求模型（所有字段可选）"""
    title: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    folder_id: Optional[UUID] = None
    order: Optional[int] = None
    refresh_interval: Optional[int] = None
    enable_deduplication: Optional[bool] = None

class Feed(FeedBase):
    """数据库 Feed 实体"""
    id: UUID
    user_id: UUID
    unread_count: int = 0
    last_fetched: Optional[datetime] = None
    last_fetch_status: Optional[str] = None  # 'success' | 'failed'
    last_fetch_error: Optional[str] = None
    enable_deduplication: bool = False
    created_at: datetime

    class Config:
        from_attributes = True  # 支持从 dict 创建
```

### Article 模型

创建 `backend/app/schemas/article.py`：

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID

class ArticleBase(BaseModel):
    title: str
    content: str
    url: str
    summary: Optional[str] = None
    author: Optional[str] = None
    published_at: datetime
    thumbnail: Optional[str] = None

class ArticleCreate(ArticleBase):
    """创建 Article 的请求模型"""
    feed_id: UUID

class Article(ArticleBase):
    """数据库 Article 实体"""
    id: UUID
    user_id: UUID
    feed_id: UUID
    is_read: bool = False
    is_starred: bool = False
    content_hash: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
```

### 使用示例

```python
from app.supabase_client import get_supabase_client
from app.schemas.feed import Feed
from typing import List

async def get_user_feeds(user_id: str, access_token: str) -> List[Feed]:
    """获取用户的所有 Feeds"""
    client = get_supabase_client(access_token)

    response = client.table("feeds") \
        .select("*") \
        .eq("user_id", user_id) \
        .order("order") \
        .execute()

    # Pydantic 自动验证和转换
    return [Feed(**item) for item in response.data]

async def update_feed_status(feed_id: str, status: str, error: str | None = None):
    """更新 Feed 抓取状态（Celery 任务使用 service client）"""
    from app.supabase_client import get_service_client

    client = get_service_client()  # 绕过 RLS

    client.table("feeds") \
        .update({
            "last_fetched": datetime.utcnow().isoformat(),
            "last_fetch_status": status,
            "last_fetch_error": error
        }) \
        .eq("id", feed_id) \
        .execute()
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

# 确保虚拟环境已激活
# Windows (Git Bash): source venv/Scripts/activate
# macOS/Linux: source venv/bin/activate

uvicorn app.main:app --reload --port 8000
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

### pip 常用命令

```bash
# 激活虚拟环境（每次开发前）
# Windows (Git Bash)
source venv/Scripts/activate
# macOS/Linux
source venv/bin/activate

# 安装所有依赖
pip install -r requirements.txt

# 添加新依赖
pip install package_name
# 然后手动添加到 requirements.txt，或使用：
pip freeze > requirements.txt  # 注意：会覆盖所有依赖

# 安装开发依赖（可选：使用 requirements-dev.txt）
pip install pytest

# 运行脚本
python script.py

# 查看已安装的包
pip list

# 升级包
pip install --upgrade package_name
```

### 数据库相关

```bash
# 使用 Supabase CLI 生成类型（可选）
supabase gen types typescript --project-id your-project-id > lib/supabase/types.ts
```

## 常见问题

### 1. pip 安装失败

```bash
# 更新 pip
pip install --upgrade pip

# 清除缓存重试
pip cache purge
pip install -r requirements.txt

# 如果某个包安装失败，尝试单独安装
pip install package_name --no-cache-dir
```

### 2. Redis 连接失败

```bash
# 检查 Redis 是否运行
redis-cli ping

# 检查端口占用
lsof -i :6379
```

### 3. Supabase 连接失败

确保 `.env` 中的配置正确：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**调试方法**:

```python
from supabase import create_client
client = create_client(url, key)
# 测试连接
result = client.table("feeds").select("count").limit(1).execute()
print(result)
```

### 4. Supabase JWT 验证失败

检查以下配置：

- `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 是否与前端配置一致
- JWT Token 是否已过期
- RLS 策略是否正确配置

### 5. RLS 权限错误

如果收到 `new row violates row-level security policy` 错误：

- 检查 Supabase 表的 RLS 策略
- 确保请求携带了有效的 JWT Token
- 后台任务应使用 `get_service_client()` 绕过 RLS

## 下一步

完成环境搭建后，继续阅读：

- [RSS 功能迁移详细步骤](./12-rss-migration-to-fastapi.md)
