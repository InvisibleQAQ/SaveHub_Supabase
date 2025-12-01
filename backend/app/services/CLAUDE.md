# Services Module

Backend 业务逻辑层，使用 Supabase Python SDK 实现数据持久化。

## 目录结构

```
services/
└── db/                     # 数据库服务模块
    ├── __init__.py         # 导出所有服务类
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

## 服务说明

| 服务 | 功能 |
|------|------|
| `FeedService` | 订阅源增删改查、级联删除文章 |
| `ArticleService` | 文章增删改查、过期清理、统计分析 |
| `FolderService` | 文件夹增删改查 |
| `SettingsService` | 用户偏好设置（主题、刷新间隔等） |
| `ApiConfigService` | OpenAI兼容API配置（无加密，需自行实现） |

## 注意事项

- `ApiConfigService` 未实现加密，敏感数据明文存储
- 前端 TypeScript 版本包含加密逻辑，参见 `lib/db/api-configs.ts`
