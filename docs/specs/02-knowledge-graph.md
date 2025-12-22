# 知识图谱功能规格

> 知识实体、关系边、向量嵌入的核心功能设计

## 核心概念

### 知识实体 (KnowledgeEntity)

知识实体是知识图谱的节点，代表一个独立的知识单元。

```typescript
interface KnowledgeEntity {
  id: string           // UUID
  userId: string       // 用户隔离
  name: string         // 实体名称 (必填)
  description: string  // 描述 (可选)
  entityType: EntityType
  embedding: number[]  // 1536维向量
  sourceType: SourceType
  sourceId: string     // 来源记录ID
  metadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

// 实体类型
type EntityType =
  | 'concept'       // 概念/定义
  | 'person'        // 人物
  | 'organization'  // 组织/公司
  | 'location'      // 地点
  | 'event'         // 事件
  | 'project'       // 项目
  | 'idea'          // 想法
  | 'tool'          // 工具/软件
  | 'book'          // 书籍/文献

// 来源类型
type SourceType =
  | 'article'        // RSS文章
  | 'content_source' // 内容源(URL/PDF/音频/图像)
  | 'scratchpad'     // 草稿
  | 'manual'         // 手动创建
```

### 关系边 (RelatesTo)

关系边连接两个知识实体，表示它们之间的关联。

```typescript
interface RelatesTo {
  id: string
  userId: string
  sourceEntityId: string  // 源实体
  targetEntityId: string  // 目标实体
  relationType: RelationType
  weight: number          // 0.0 - 1.0
  metadata: Record<string, any>
  createdAt: Date
}

// 关系类型
type RelationType =
  | 'related_to'   // 相关 (默认)
  | 'part_of'      // 属于/组成
  | 'instance_of'  // 实例/类型
  | 'causes'       // 导致
  | 'precedes'     // 先于
  | 'contradicts'  // 矛盾
  | 'supports'     // 支持
```

---

## 功能列表

### 1. 实体 CRUD

| 操作 | API | 描述 |
|------|-----|------|
| 创建 | `POST /api/knowledge/entities` | 创建新实体 |
| 列表 | `GET /api/knowledge/entities` | 分页+过滤 |
| 详情 | `GET /api/knowledge/entities/{id}` | 获取单个 |
| 更新 | `PUT /api/knowledge/entities/{id}` | 更新实体 |
| 删除 | `DELETE /api/knowledge/entities/{id}` | 删除（级联删除关系） |

### 2. 关系 CRUD

| 操作 | API | 描述 |
|------|-----|------|
| 创建 | `POST /api/knowledge/relations` | 创建关系 |
| 列表 | `GET /api/knowledge/relations` | 过滤查询 |
| 删除 | `DELETE /api/knowledge/relations/{id}` | 删除关系 |

### 3. 向量搜索

| 操作 | API | 描述 |
|------|-----|------|
| 语义搜索 | `POST /api/knowledge/entities/search` | 向量相似度搜索 |
| 相关实体 | `GET /api/knowledge/entities/{id}/related` | 获取关联实体 |

---

## 详细规格

### 创建实体

**请求**:
```http
POST /api/knowledge/entities
Content-Type: application/json

{
  "name": "Rust语言",
  "description": "一种系统编程语言，强调安全性、并发性和性能",
  "entityType": "tool",
  "metadata": {
    "aliases": ["Rust", "Rust-lang"],
    "url": "https://www.rust-lang.org"
  }
}
```

**处理流程**:
1. 验证输入
2. 生成嵌入向量（调用 LLM embedding API）
3. 插入数据库
4. 返回创建的实体

**响应**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Rust语言",
  "description": "一种系统编程语言...",
  "entityType": "tool",
  "embedding": null,  // 不返回完整向量
  "hasEmbedding": true,
  "sourceType": "manual",
  "metadata": {...},
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

### 实体列表查询

**请求**:
```http
GET /api/knowledge/entities?
  page=1&
  pageSize=20&
  entityType=concept&
  sourceType=article&
  search=编程&
  sortBy=createdAt&
  sortOrder=desc
```

**支持的过滤器**:
- `entityType`: 实体类型
- `sourceType`: 来源类型
- `search`: 名称/描述模糊搜索
- `createdAfter`: 创建时间下限
- `createdBefore`: 创建时间上限

**响应**:
```json
{
  "data": [
    {
      "id": "...",
      "name": "Rust语言",
      "description": "...",
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

### 向量语义搜索

**请求**:
```http
POST /api/knowledge/entities/search
Content-Type: application/json

{
  "query": "系统编程语言的内存安全特性",
  "topK": 10,
  "threshold": 0.7,  // 相似度阈值
  "entityTypes": ["concept", "tool"],  // 可选过滤
  "includeRelated": true  // 是否包含关联实体
}
```

**处理流程**:
1. 将查询文本转换为嵌入向量
2. pgvector KNN 搜索（余弦相似度）
3. 可选：扩展关联实体
4. 返回排序结果

**响应**:
```json
{
  "results": [
    {
      "entity": {
        "id": "...",
        "name": "Rust语言",
        "description": "...",
        "entityType": "tool"
      },
      "score": 0.92,
      "relatedEntities": [
        {
          "entity": {"id": "...", "name": "所有权系统"},
          "relation": "part_of",
          "score": 0.85
        }
      ]
    }
  ],
  "queryEmbeddingTime": 120,  // ms
  "searchTime": 45  // ms
}
```

### 创建关系

**请求**:
```http
POST /api/knowledge/relations
Content-Type: application/json

{
  "sourceEntityId": "550e8400-e29b-41d4-a716-446655440000",
  "targetEntityId": "660e8400-e29b-41d4-a716-446655440001",
  "relationType": "part_of",
  "weight": 0.9,
  "metadata": {
    "context": "Rust的所有权系统是其核心特性之一"
  }
}
```

**约束**:
- 不能自环（source != target）
- 同类型关系不重复

**响应**:
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "sourceEntityId": "...",
  "targetEntityId": "...",
  "relationType": "part_of",
  "weight": 0.9,
  "createdAt": "..."
}
```

### 获取关联实体

**请求**:
```http
GET /api/knowledge/entities/{id}/related?
  direction=both&  // in, out, both
  relationTypes=part_of,related_to&
  depth=2&  // 遍历深度
  limit=20
```

**响应**:
```json
{
  "entity": {
    "id": "...",
    "name": "Rust语言"
  },
  "relations": {
    "outgoing": [
      {
        "relation": {
          "id": "...",
          "relationType": "related_to",
          "weight": 0.8
        },
        "targetEntity": {
          "id": "...",
          "name": "C++",
          "entityType": "tool"
        }
      }
    ],
    "incoming": [
      {
        "relation": {...},
        "sourceEntity": {...}
      }
    ]
  }
}
```

---

## 嵌入生成策略

### 触发时机

| 场景 | 触发方式 | 优先级 |
|------|---------|--------|
| 创建实体 | 同步生成 | 高 |
| 更新实体（name/description变化） | 异步任务 | 中 |
| 批量导入 | 异步批量任务 | 低 |

### 嵌入文本格式

```python
def build_embedding_text(entity: KnowledgeEntity) -> str:
    """构建用于生成嵌入的文本"""
    parts = [entity.name]

    if entity.description:
        parts.append(entity.description)

    if entity.entity_type:
        parts.append(f"Type: {entity.entity_type}")

    # 添加别名
    aliases = entity.metadata.get("aliases", [])
    if aliases:
        parts.append(f"Also known as: {', '.join(aliases)}")

    return "\n".join(parts)
```

### 批量嵌入任务

```python
@celery_app.task(name="batch_embed_entities")
def batch_embed_entities(user_id: str, entity_ids: list[str], batch_size: int = 50):
    """批量生成实体嵌入"""
    for batch in chunks(entity_ids, batch_size):
        entities = fetch_entities(batch)
        texts = [build_embedding_text(e) for e in entities]
        embeddings = embedding_service.batch_embed(texts)

        for entity, embedding in zip(entities, embeddings):
            update_entity_embedding(entity.id, embedding)
```

---

## 去重策略

### 实体去重

当创建新实体时，检查是否存在相似实体：

```python
async def check_duplicate(name: str, embedding: list[float], threshold: float = 0.95) -> Optional[KnowledgeEntity]:
    """检查是否存在重复实体"""
    # 1. 精确名称匹配
    existing = await db.query(
        "SELECT * FROM knowledge_entity WHERE name ILIKE $1 AND user_id = $2",
        name, user_id
    )
    if existing:
        return existing[0]

    # 2. 向量相似度检查
    similar = await db.query("""
        SELECT *, 1 - (embedding <=> $1) as similarity
        FROM knowledge_entity
        WHERE user_id = $2
          AND 1 - (embedding <=> $1) > $3
        ORDER BY embedding <=> $1
        LIMIT 1
    """, embedding, user_id, threshold)

    if similar:
        return similar[0]

    return None
```

### 合并策略

当检测到重复时，提供以下选项：

1. **跳过**: 不创建新实体
2. **合并**: 更新现有实体，添加新来源
3. **强制创建**: 忽略重复，创建新实体

---

## 服务层设计

### KnowledgeService

```python
# backend/app/services/db/knowledge.py

class KnowledgeService:
    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    async def create_entity(self, data: CreateEntityInput) -> KnowledgeEntity:
        """创建知识实体"""
        pass

    async def get_entity(self, entity_id: str) -> Optional[KnowledgeEntity]:
        """获取单个实体"""
        pass

    async def list_entities(self, filters: EntityFilters) -> PaginatedResult:
        """列表查询"""
        pass

    async def update_entity(self, entity_id: str, data: UpdateEntityInput) -> KnowledgeEntity:
        """更新实体"""
        pass

    async def delete_entity(self, entity_id: str) -> bool:
        """删除实体（级联删除关系）"""
        pass

    async def search_entities(self, query: str, options: SearchOptions) -> list[SearchResult]:
        """向量语义搜索"""
        pass

    async def get_related_entities(self, entity_id: str, options: RelatedOptions) -> RelatedResult:
        """获取关联实体"""
        pass
```

### RelationService

```python
# backend/app/services/db/relations.py

class RelationService:
    def __init__(self, supabase: Client, user_id: str):
        self.supabase = supabase
        self.user_id = user_id

    async def create_relation(self, data: CreateRelationInput) -> Relation:
        """创建关系"""
        pass

    async def list_relations(self, filters: RelationFilters) -> list[Relation]:
        """列表查询"""
        pass

    async def delete_relation(self, relation_id: str) -> bool:
        """删除关系"""
        pass

    async def get_graph_data(self, center_entity_id: Optional[str], depth: int) -> GraphData:
        """获取图数据（用于可视化）"""
        pass
```

---

## 前端 Zustand Slice

```typescript
// frontend/lib/store/knowledge.slice.ts

export interface KnowledgeSlice {
  // State
  entities: KnowledgeEntity[]
  selectedEntity: KnowledgeEntity | null
  relations: Relation[]
  isLoading: boolean
  searchResults: SearchResult[]
  isSearching: boolean

  // Actions
  fetchEntities: (filters?: EntityFilters) => Promise<void>
  createEntity: (data: CreateEntityInput) => Promise<KnowledgeEntity>
  updateEntity: (id: string, data: UpdateEntityInput) => Promise<void>
  deleteEntity: (id: string) => Promise<void>
  selectEntity: (id: string | null) => void

  // Relations
  fetchRelations: (entityId: string) => Promise<void>
  createRelation: (data: CreateRelationInput) => Promise<void>
  deleteRelation: (id: string) => Promise<void>

  // Search
  searchEntities: (query: string, options?: SearchOptions) => Promise<void>
  clearSearchResults: () => void
}

export const createKnowledgeSlice: StateCreator<KnowledgeSlice> = (set, get) => ({
  entities: [],
  selectedEntity: null,
  relations: [],
  isLoading: false,
  searchResults: [],
  isSearching: false,

  fetchEntities: async (filters) => {
    set({ isLoading: true })
    try {
      const response = await knowledgeApi.listEntities(filters)
      set({ entities: response.data })
    } finally {
      set({ isLoading: false })
    }
  },

  searchEntities: async (query, options) => {
    set({ isSearching: true })
    try {
      const results = await knowledgeApi.searchEntities(query, options)
      set({ searchResults: results })
    } finally {
      set({ isSearching: false })
    }
  },

  // ... 其他 actions
})
```

---

## 下一步

继续阅读 `03-content-ingestion.md` 了解内容摄取管道的详细规格。
