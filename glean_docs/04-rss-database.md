# 数据库模型

本文档详细介绍 Glean 中与 RSS Feed 相关的数据库模型设计。

## 技术栈

- **PostgreSQL 16**: 主数据库
- **SQLAlchemy 2.0**: ORM (异步模式)
- **asyncpg**: PostgreSQL 异步驱动
- **Alembic**: 数据库迁移

## 模型关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           User                                       │
│  id, email, password_hash, settings                                  │
└────────┬──────────────────────────────────────┬─────────────────────┘
         │ 1:N                                  │ 1:N
         ▼                                      ▼
┌─────────────────────┐                ┌─────────────────────┐
│    Subscription     │                │     UserEntry       │
│  id, user_id,       │                │  id, user_id,       │
│  feed_id,           │                │  entry_id,          │
│  custom_title,      │                │  is_read, is_liked, │
│  folder_id          │                │  read_later,        │
└────────┬────────────┘                │  read_later_until   │
         │ N:1                         └──────────┬──────────┘
         ▼                                        │ N:1
┌─────────────────────┐                           │
│       Feed          │                           │
│  id, url, title,    │                           │
│  status, etag,      │                           │
│  next_fetch_at      │                           │
└────────┬────────────┘                           │
         │ 1:N                                    │
         ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           Entry                                      │
│  id, feed_id, guid, url, title, content, published_at               │
└─────────────────────────────────────────────────────────────────────┘
```

## 核心模型

### 1. Feed (RSS 源)

**文件路径**: `backend/packages/database/glean_database/models/feed.py`

```python
from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, generate_uuid


class FeedStatus(str, Enum):
    """Feed 状态枚举"""
    ACTIVE = "active"      # 正常
    ERROR = "error"        # 错误 (已禁用)
    DISABLED = "disabled"  # 手动禁用


class Feed(Base, TimestampMixin):
    """
    RSS Feed 模型。

    Feed 全局共享，避免多用户重复拉取同一源。
    """

    __tablename__ = "feeds"

    # 主键
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)

    # Feed 元数据
    url: Mapped[str] = mapped_column(String(2000), unique=True, nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(500))
    site_url: Mapped[str | None] = mapped_column(String(2000))
    description: Mapped[str | None] = mapped_column(String(2000))
    icon_url: Mapped[str | None] = mapped_column(String(500))
    language: Mapped[str | None] = mapped_column(String(10))

    # 拉取状态
    status: Mapped[FeedStatus] = mapped_column(String(20), default=FeedStatus.ACTIVE, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    fetch_error_message: Mapped[str | None] = mapped_column(String(1000))
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_entry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_fetch_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    # HTTP 条件请求头
    etag: Mapped[str | None] = mapped_column(String(255))
    last_modified: Mapped[str | None] = mapped_column(String(255))

    # 关系
    entries = relationship("Entry", back_populates="feed", cascade="all, delete-orphan")
    subscriptions = relationship("Subscription", back_populates="feed", cascade="all, delete-orphan")
```

**字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | String(2000) | Feed URL，唯一索引 |
| `status` | Enum | ACTIVE/ERROR/DISABLED |
| `error_count` | Integer | 连续失败次数 |
| `next_fetch_at` | DateTime | 下次拉取时间，索引字段 |
| `etag` | String | HTTP ETag 头 |
| `last_modified` | String | HTTP Last-Modified 头 |

### 2. Entry (文章条目)

**文件路径**: `backend/packages/database/glean_database/models/entry.py`

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, generate_uuid


class Entry(Base, TimestampMixin):
    """
    Feed 条目 (文章) 模型。

    条目全局共享，用户状态通过 UserEntry 关联。
    """

    __tablename__ = "entries"

    # 主键
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)

    # 所属 Feed
    feed_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("feeds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 条目内容
    url: Mapped[str] = mapped_column(String(2000), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(1000), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200))
    content: Mapped[str | None] = mapped_column(Text)   # 完整内容 (HTML)
    summary: Mapped[str | None] = mapped_column(Text)   # 摘要

    # 元数据
    guid: Mapped[str | None] = mapped_column(String(500), index=True)  # 原始 GUID
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    # 关系
    feed = relationship("Feed", back_populates="entries")
    user_entries = relationship("UserEntry", back_populates="entry", cascade="all, delete-orphan")
    bookmarks = relationship("Bookmark", back_populates="entry")

    # 约束: 每个 Feed 内 GUID 唯一
    __table_args__ = (UniqueConstraint("feed_id", "guid", name="uq_feed_guid"),)
```

**去重机制**:
- 使用 `(feed_id, guid)` 唯一约束
- Worker 拉取时先查询是否存在相同 GUID
- GUID 来源: RSS 条目的 `<id>` 或 `<link>` 标签

### 3. Subscription (用户订阅)

**文件路径**: `backend/packages/database/glean_database/models/subscription.py`

```python
from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, generate_uuid


class Subscription(Base, TimestampMixin):
    """
    用户-Feed 订阅关系。

    连接用户和 Feed，支持自定义标题和文件夹分组。
    """

    __tablename__ = "subscriptions"

    # 主键
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)

    # 外键
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    feed_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("feeds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 自定义设置
    custom_title: Mapped[str | None] = mapped_column(String(500))  # 用户自定义标题

    # 文件夹组织
    folder_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 关系
    user = relationship("User", back_populates="subscriptions")
    feed = relationship("Feed", back_populates="subscriptions")
    folder = relationship("Folder", back_populates="subscriptions")

    # 约束: 用户只能订阅同一 Feed 一次
    __table_args__ = (UniqueConstraint("user_id", "feed_id", name="uq_user_feed"),)
```

**设计要点**:
- 用户可自定义订阅标题 (`custom_title`)
- 订阅可归类到文件夹 (`folder_id`)
- 删除用户时级联删除订阅
- 删除文件夹时将订阅的 folder_id 设为 NULL

### 4. UserEntry (用户条目状态)

**文件路径**: `backend/packages/database/glean_database/models/user_entry.py`

```python
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, generate_uuid


class UserEntry(Base, TimestampMixin):
    """
    用户与条目的交互状态。

    仅在用户与条目交互时创建 (懒加载)。
    """

    __tablename__ = "user_entries"

    # 主键
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)

    # 外键
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entry_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("entries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 用户状态
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_liked: Mapped[bool | None] = mapped_column(Boolean)  # True=喜欢, False=不喜欢, None=未设置
    read_later: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_later_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 过期时间

    # 推荐数据
    preference_score: Mapped[float | None] = mapped_column(Float)

    # 操作时间戳
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    liked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # 关系
    user = relationship("User", back_populates="user_entries")
    entry = relationship("Entry", back_populates="user_entries")
    user_entry_tags = relationship("UserEntryTag", back_populates="user_entry", cascade="all, delete-orphan")

    # 约束: 每个用户-条目对只有一条记录
    __table_args__ = (UniqueConstraint("user_id", "entry_id", name="uq_user_entry"),)
```

**状态说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `is_read` | Boolean | 是否已读 (默认 False) |
| `is_liked` | Boolean? | True=喜欢, False=不喜欢, None=未设置 |
| `read_later` | Boolean | 是否标记为稍后阅读 |
| `read_later_until` | DateTime | 稍后阅读过期时间 |
| `read_at` | DateTime | 标记已读的时间 |
| `liked_at` | DateTime | 点赞/踩的时间 |

## 未读计数逻辑

判断条目是否未读:

```python
# 未读 = 没有 UserEntry 记录 OR is_read = False
from sqlalchemy import select, func

async def count_unread(session, user_id: str, feed_id: str) -> int:
    stmt = (
        select(func.count(Entry.id))
        .where(Entry.feed_id == feed_id)
        .outerjoin(
            UserEntry,
            (UserEntry.entry_id == Entry.id) & (UserEntry.user_id == user_id)
        )
        .where(
            (UserEntry.id.is_(None)) |  # 没有记录
            (UserEntry.is_read.is_(False))  # 或 is_read = False
        )
    )
    result = await session.execute(stmt)
    return result.scalar() or 0
```

## 数据库迁移

### 目录结构

```
backend/packages/database/glean_database/
├── models/
│   ├── __init__.py
│   ├── base.py           # Base 类和 Mixin
│   ├── user.py
│   ├── feed.py
│   ├── entry.py
│   ├── subscription.py
│   ├── user_entry.py
│   └── ...
├── migrations/
│   ├── versions/         # 迁移脚本
│   └── env.py
├── session.py            # 会话管理
└── alembic.ini
```

### 常用命令

```bash
# 创建迁移
make db-migrate MSG="add_field_to_table"

# 应用迁移
make db-upgrade

# 回滚迁移
make db-downgrade

# 重置数据库
make db-reset
```

## Base 类和 Mixin

**文件路径**: `backend/packages/database/glean_database/models/base.py`

```python
from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def generate_uuid() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    """所有模型的基类"""
    pass


class TimestampMixin:
    """
    自动添加 created_at 和 updated_at 字段。
    """
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
```

## 会话管理

**文件路径**: `backend/packages/database/glean_database/session.py`

```python
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

_engine = None
_session_factory = None


def init_database(database_url: str) -> None:
    """初始化数据库连接"""
    global _engine, _session_factory
    _engine = create_async_engine(database_url, echo=False)
    _session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """获取数据库会话 (异步生成器)"""
    if _session_factory is None:
        raise RuntimeError("Database not initialized")
    async with _session_factory() as session:
        yield session
```

## 相关文档

- [系统概述](./01-rss-overview.md)
- [后台任务](./02-rss-worker-tasks.md)
- [RSS 解析](./03-rss-parsing.md)
- [API 接口](./05-rss-api.md)
