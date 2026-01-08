# Services Module

Backend 业务逻辑层，使用 Supabase Python SDK 实现数据持久化。

## 目录结构

```
services/
├── realtime.py             # ConnectionManager - WebSocket 连接管理
├── supabase_realtime.py    # SupabaseRealtimeForwarder - Supabase postgres_changes 转发
├── rss_parser.py           # RSS 解析服务
└── db/                     # 数据库服务模块
    ├── __init__.py         # 导出所有服务类
    ├── base.py             # BaseDbService - 所有服务的基类
    ├── feeds.py            # FeedService - RSS订阅源 CRUD
    ├── articles.py         # ArticleService - 文章 CRUD + 统计 + 清理
    ├── folders.py          # FolderService - 文件夹 CRUD
    ├── settings.py         # SettingsService - 用户设置管理
    └── api_configs.py      # ApiConfigService - API配置管理
```

## 设计模式

**服务类初始化**:
```python
service = FeedService(supabase_client, user_id)
```

**共同特性**:
- 所有操作自动绑定 `user_id`（用户隔离）
- 使用 Supabase SDK 的链式查询
- 返回 Python dict（非 ORM 对象）
- 对应前端 `lib/db/*.ts` 的功能

## BaseDbService (base.py)

所有数据库服务的基类，提供统一的查询、更新、错误处理模式。

**核心方法**:

| 方法 | 说明 |
|------|------|
| `_query(select)` | 创建带 user_id 过滤的 SELECT 查询 |
| `_get_one(filters)` | 获取单条记录，使用 `.limit(1)` 避免异常 |
| `_get_many(filters, order_by, limit)` | 获取多条记录 |
| `_prepare_update_data(updates, allowed_fields)` | 准备更新数据，自动处理 datetime 转换 |
| `_update_one(record_id, updates)` | 更新单条记录 |
| `_delete_one(record_id)` | 删除单条记录 |
| `_row_to_dict(row)` | 数据库行转字典（子类覆盖） |
| `_dict_to_row(data)` | 字典转数据库行，自动添加 user_id |
| `_is_duplicate_error(e)` | 检测重复键错误 (23505) |
| `_is_not_found_error(e)` | 检测记录不存在错误 (PGRST116) |

**创建新服务**:
```python
from .base import BaseDbService

class MyService(BaseDbService):
    table_name = "my_table"  # 必须设置
    UPDATE_FIELDS = {"field1", "field2"}  # 可选：允许更新的字段

    def _row_to_dict(self, row: dict) -> dict:
        """覆盖此方法定义行转换逻辑"""
        return {
            "id": row["id"],
            "field1": row["field1"],
            # ...
        }

    def get_item(self, item_id: str):
        return self._get_one({"id": item_id})

    def list_items(self):
        return self._get_many(order_by="created_at", order_desc=True)
```

## 服务说明

| 服务 | 功能 |
|------|------|
| `ConnectionManager` | WebSocket 连接管理（多标签页支持） |
| `SupabaseRealtimeForwarder` | 订阅 Supabase postgres_changes，转发给 WebSocket 客户端 |
| `FeedService` | 订阅源增删改查、级联删除文章 |
| `ArticleService` | 文章增删改查、过期清理、统计分析 |
| `FolderService` | 文件夹增删改查 |
| `SettingsService` | 用户偏好设置（主题、刷新间隔等） |
| `ApiConfigService` | OpenAI兼容API配置（无加密，需自行实现） |

## ConnectionManager (realtime.py)

WebSocket 连接管理器，支持多标签页场景。

**使用方式**:
```python
from app.services.realtime import connection_manager

# 连接
await connection_manager.connect(websocket, user_id)

# 发送消息给用户
await connection_manager.send_to_user(user_id, {"event": "update", "data": {...}})

# 断开连接
connection_manager.disconnect(websocket, user_id)
```

**数据结构**: `user_id -> List[WebSocket]` 映射，单用户可有多个连接，自动清理断开的连接。

## SupabaseRealtimeForwarder (supabase_realtime.py)

订阅 Supabase postgres_changes，将数据库变更事件转发给 WebSocket 客户端。

**使用方式**:
```python
from app.services.supabase_realtime import realtime_forwarder

# 启动订阅（通常在应用启动时调用）
await realtime_forwarder.start()

# 停止订阅（通常在应用关闭时调用）
await realtime_forwarder.stop()

# 检查运行状态
is_running = realtime_forwarder.is_running
```

**订阅的表**: `feeds`, `articles`, `folders`

**消息格式** (转发给 WebSocket 客户端):
```json
{
  "type": "postgres_changes",
  "table": "feeds",
  "event": "INSERT|UPDATE|DELETE",
  "payload": {
    "new": { ... },
    "old": { ... }
  }
}
```

**工作流程**:
1. 订阅 Supabase Realtime 的 postgres_changes
2. 收到变更时，从 payload 提取 `user_id`
3. 通过 `ConnectionManager.send_to_user()` 转发给该用户的所有 WebSocket 连接

## 注意事项

- `ApiConfigService` 未实现加密，敏感数据明文存储
- 前端 TypeScript 版本包含加密逻辑，参见 `lib/db/api-configs.ts`
