# API 端点设计

> 完整的后端 API 规格文档

## 概览

### 基础信息

- **基础路径**: `/api`
- **认证方式**: Supabase JWT (Cookie: `sb_access_token`)
- **内容类型**: `application/json`（除文件上传外）
- **错误格式**: `{"error": "message", "code": "ERROR_CODE"}`

### 路由结构

```
/api
├── /knowledge           # 知识实体
│   ├── /entities        # 实体 CRUD
│   └── /relations       # 关系 CRUD
├── /content             # 内容摄取
├── /scratchpad          # 草稿系统
├── /conversation        # 对话系统
├── /graph               # 图可视化
├── /admin               # 管理设置
└── /health              # 健康检查
```

---

## 知识实体 API

### 创建实体

```http
POST /api/knowledge/entities
Content-Type: application/json

{
  "name": "Rust语言",
  "description": "系统编程语言",
  "entityType": "tool",
  "metadata": {
    "aliases": ["Rust", "Rust-lang"]
  }
}
```

**响应** `201 Created`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Rust语言",
  "description": "系统编程语言",
  "entityType": "tool",
  "hasEmbedding": true,
  "sourceType": "manual",
  "metadata": {"aliases": ["Rust", "Rust-lang"]},
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

### 获取实体列表

```http
GET /api/knowledge/entities?page=1&pageSize=20&entityType=concept&search=编程
```

**参数**:
| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| page | int | 1 | 页码 |
| pageSize | int | 20 | 每页数量 (max 100) |
| entityType | string | - | 实体类型过滤 |
| sourceType | string | - | 来源类型过滤 |
| search | string | - | 名称/描述搜索 |
| sortBy | string | createdAt | 排序字段 |
| sortOrder | string | desc | 排序方向 |

**响应** `200 OK`:
```json
{
  "data": [
    {
      "id": "...",
      "name": "Rust语言",
      "entityType": "tool",
      "hasEmbedding": true,
      "relationsCount": 5,
      "createdAt": "..."
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### 获取单个实体

```http
GET /api/knowledge/entities/{id}
```

**响应** `200 OK`:
```json
{
  "id": "550e8400-...",
  "name": "Rust语言",
  "description": "系统编程语言",
  "entityType": "tool",
  "hasEmbedding": true,
  "sourceType": "content_source",
  "sourceId": "660e8400-...",
  "metadata": {...},
  "relations": {
    "outgoing": [...],
    "incoming": [...]
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

### 更新实体

```http
PUT /api/knowledge/entities/{id}
Content-Type: application/json

{
  "name": "Rust编程语言",
  "description": "更新的描述"
}
```

### 删除实体

```http
DELETE /api/knowledge/entities/{id}
```

**响应** `200 OK`:
```json
{
  "deleted": true,
  "cascadeDeleted": {
    "relations": 5
  }
}
```

### 语义搜索

```http
POST /api/knowledge/entities/search
Content-Type: application/json

{
  "query": "Rust内存安全",
  "topK": 10,
  "threshold": 0.7,
  "entityTypes": ["concept", "tool"],
  "weights": {
    "vector": 0.5,
    "fts": 0.3,
    "graph": 0.2
  },
  "includeRelated": true
}
```

**响应** `200 OK`:
```json
{
  "results": [
    {
      "entity": {...},
      "scores": {
        "vector": 0.92,
        "fts": 0.85,
        "graph": 0.60,
        "final": 0.81
      },
      "sources": ["vector", "fts"],
      "relatedEntities": [...]
    }
  ],
  "searchTimeMs": 156
}
```

---

## 关系 API

### 创建关系

```http
POST /api/knowledge/relations
Content-Type: application/json

{
  "sourceEntityId": "550e8400-...",
  "targetEntityId": "660e8400-...",
  "relationType": "part_of",
  "weight": 0.9,
  "metadata": {
    "context": "..."
  }
}
```

### 获取关系列表

```http
GET /api/knowledge/relations?
  entityId={id}&
  direction=both&
  relationType=part_of
```

### 删除关系

```http
DELETE /api/knowledge/relations/{id}
```

---

## 内容摄取 API

### 创建内容摄取

```http
POST /api/content/ingest
Content-Type: multipart/form-data

type=url
url=https://example.com/article

# 或
type=file
file=@document.pdf

# 或
type=text
content=这是一段文本
title=我的笔记
```

**响应** `202 Accepted`:
```json
{
  "id": "770e8400-...",
  "sourceType": "url",
  "title": "Article Title",
  "processingStatus": "pending",
  "taskId": "celery-task-id",
  "createdAt": "..."
}
```

### 获取内容源列表

```http
GET /api/content/sources?
  page=1&
  pageSize=20&
  sourceType=pdf&
  status=completed
```

### 获取单个内容源

```http
GET /api/content/sources/{id}
```

**响应** `200 OK`:
```json
{
  "id": "...",
  "sourceType": "url",
  "title": "Article Title",
  "url": "https://...",
  "content": "提取的文本内容...",
  "processingStatus": "completed",
  "processedAt": "...",
  "entities": [
    {"id": "...", "name": "Entity 1"}
  ]
}
```

### 删除内容源

```http
DELETE /api/content/sources/{id}
```

---

## 草稿 API

### 创建笔记

```http
POST /api/scratchpad
Content-Type: application/json

{
  "content": "# 今天学到的\n\n..."
}
```

### 获取笔记列表

```http
GET /api/scratchpad?isArchived=false&page=1&pageSize=20
```

### 更新笔记

```http
PUT /api/scratchpad/{id}
Content-Type: application/json

{
  "content": "更新的内容"
}
```

### 删除笔记

```http
DELETE /api/scratchpad/{id}
```

### 归档笔记

```http
POST /api/scratchpad/{id}/archive
Content-Type: application/json

{
  "triggerIngestion": true
}
```

**响应** `200 OK`:
```json
{
  "id": "...",
  "isArchived": true,
  "archivedAt": "...",
  "ingestionTaskId": "celery-task-id"
}
```

---

## 对话 API

### 创建对话

```http
POST /api/conversation
Content-Type: application/json

{
  "title": "关于Rust的问题"
}
```

### 获取对话列表

```http
GET /api/conversation?page=1&pageSize=20
```

### 获取对话详情

```http
GET /api/conversation/{id}
```

### 发送消息 (SSE)

```http
POST /api/conversation/{id}/message
Content-Type: application/json

{
  "content": "Rust的所有权系统是什么？"
}
```

**响应**: Server-Sent Events

```
event: user_message
data: {"id": "msg-id"}

event: context_ready
data: {"references": [...]}

event: chunk
data: Rust的所有权系统是

event: chunk
data: 一种内存管理机制...

event: done
data: {"id": "assistant-msg-id", "references": [...]}
```

### 获取历史消息

```http
GET /api/conversation/{id}/messages?limit=50&before={messageId}
```

### 删除对话

```http
DELETE /api/conversation/{id}
```

---

## 图数据 API

### 获取全图

```http
GET /api/graph/data?limit=100&minRelations=1
```

### 获取邻域图

```http
GET /api/graph/neighbors/{entityId}?depth=2&maxNodes=50
```

---

## 管理设置 API

### 获取设置

```http
GET /api/admin/settings
```

**响应** `200 OK`:
```json
{
  "embeddingModel": "text-embedding-3-small",
  "embeddingDimensions": 1536,
  "defaultApiConfigId": "...",
  "autoExtractFromArticles": false,
  "retrievalWeights": {
    "vector": 0.5,
    "fts": 0.3,
    "graph": 0.2
  }
}
```

### 更新设置

```http
PUT /api/admin/settings
Content-Type: application/json

{
  "autoExtractFromArticles": true,
  "retrievalWeights": {
    "vector": 0.6,
    "fts": 0.25,
    "graph": 0.15
  }
}
```

---

## 错误码

| HTTP状态码 | 错误码 | 描述 |
|------------|--------|------|
| 400 | INVALID_INPUT | 请求参数无效 |
| 401 | UNAUTHORIZED | 未认证 |
| 403 | FORBIDDEN | 无权限 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 资源冲突（如重复） |
| 422 | VALIDATION_ERROR | 数据验证失败 |
| 429 | RATE_LIMITED | 请求过于频繁 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |

**错误响应格式**:
```json
{
  "error": "Entity not found",
  "code": "NOT_FOUND",
  "details": {
    "entityId": "550e8400-..."
  }
}
```

---

## 后端路由注册

```python
# backend/app/main.py

from fastapi import FastAPI
from app.api.routers import (
    knowledge,
    relations,
    content,
    scratchpad,
    conversation,
    graph,
    admin
)

app = FastAPI(title="SaveHub Knowledge API")

# 注册路由
app.include_router(knowledge.router)
app.include_router(relations.router)
app.include_router(content.router)
app.include_router(scratchpad.router)
app.include_router(conversation.router)
app.include_router(graph.router)
app.include_router(admin.router)
```

---

## 下一步

继续阅读 `09-frontend-design.md` 了解前端组件和路由设计。
