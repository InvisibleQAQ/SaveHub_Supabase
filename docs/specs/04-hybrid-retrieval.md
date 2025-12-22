# 混合检索规格

> 向量 + 全文 + 图遍历三路融合搜索

## 检索架构

```
用户查询
    │
    ├───────────────┬───────────────┬───────────────┐
    │               │               │               │
    ▼               ▼               ▼               │
┌─────────┐   ┌─────────┐   ┌─────────┐            │
│ Vector  │   │  FTS    │   │  Graph  │            │
│ Search  │   │ Search  │   │Traversal│            │
└────┬────┘   └────┬────┘   └────┬────┘            │
     │             │             │                  │
     │ score_v     │ score_f     │ score_g         │
     │             │             │                  │
     └─────────────┴─────────────┴──────────────────┘
                         │
                         ▼
                 ┌───────────────┐
                 │ Score Fusion  │
                 │ 0.5v+0.3f+0.2g│
                 └───────┬───────┘
                         │
                         ▼
                 ┌───────────────┐
                 │   Re-rank     │
                 │  (可选)       │
                 └───────┬───────┘
                         │
                         ▼
                 ┌───────────────┐
                 │   返回结果    │
                 └───────────────┘
```

---

## 三路搜索详解

### 1. 向量搜索 (Vector Search)

使用 pgvector 的 HNSW 索引进行 K近邻搜索。

```sql
-- 向量相似度搜索 (余弦距离)
SELECT
  id,
  name,
  description,
  entity_type,
  1 - (embedding <=> $1) as similarity
FROM knowledge_entity
WHERE user_id = $2
  AND embedding IS NOT NULL
ORDER BY embedding <=> $1
LIMIT $3;
```

**Python 实现**:
```python
async def vector_search(
    query_embedding: list[float],
    user_id: str,
    top_k: int = 20,
    threshold: float = 0.5
) -> list[SearchResult]:
    """向量语义搜索"""

    results = await supabase.rpc(
        "vector_search_entities",
        {
            "query_embedding": query_embedding,
            "user_id": user_id,
            "match_count": top_k,
            "match_threshold": threshold
        }
    ).execute()

    return [
        SearchResult(
            entity_id=r["id"],
            name=r["name"],
            description=r["description"],
            entity_type=r["entity_type"],
            score=r["similarity"],
            source="vector"
        )
        for r in results.data
    ]
```

**数据库函数**:
```sql
CREATE OR REPLACE FUNCTION vector_search_entities(
  query_embedding vector(1536),
  user_id uuid,
  match_count int DEFAULT 10,
  match_threshold float DEFAULT 0.5
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  entity_type text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ke.id,
    ke.name,
    ke.description,
    ke.entity_type,
    1 - (ke.embedding <=> query_embedding) as similarity
  FROM knowledge_entity ke
  WHERE ke.user_id = vector_search_entities.user_id
    AND ke.embedding IS NOT NULL
    AND 1 - (ke.embedding <=> query_embedding) > match_threshold
  ORDER BY ke.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

### 2. 全文搜索 (FTS)

使用 PostgreSQL 内置的全文搜索功能。

```sql
-- 全文搜索 (BM25风格排名)
SELECT
  id,
  name,
  description,
  entity_type,
  ts_rank_cd(fts_vector, query) as rank
FROM knowledge_entity,
     plainto_tsquery('english', $1) query
WHERE user_id = $2
  AND fts_vector @@ query
ORDER BY rank DESC
LIMIT $3;
```

**Python 实现**:
```python
async def fulltext_search(
    query: str,
    user_id: str,
    top_k: int = 20
) -> list[SearchResult]:
    """全文搜索"""

    # 处理查询词
    search_query = " & ".join(query.split())  # AND 连接

    results = await supabase.rpc(
        "fulltext_search_entities",
        {
            "search_query": search_query,
            "user_id": user_id,
            "match_count": top_k
        }
    ).execute()

    return [
        SearchResult(
            entity_id=r["id"],
            name=r["name"],
            description=r["description"],
            entity_type=r["entity_type"],
            score=r["rank"],
            source="fts"
        )
        for r in results.data
    ]
```

**数据库函数**:
```sql
CREATE OR REPLACE FUNCTION fulltext_search_entities(
  search_query text,
  user_id uuid,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  entity_type text,
  rank float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ke.id,
    ke.name,
    ke.description,
    ke.entity_type,
    ts_rank_cd(ke.fts_vector, to_tsquery('english', search_query)) as rank
  FROM knowledge_entity ke
  WHERE ke.user_id = fulltext_search_entities.user_id
    AND ke.fts_vector @@ to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;
```

### 3. 图遍历 (Graph Traversal)

从向量搜索的高分实体出发，遍历关系获取邻域实体。

```python
async def graph_traversal(
    seed_entity_ids: list[str],
    user_id: str,
    depth: int = 2,
    max_neighbors: int = 10
) -> list[SearchResult]:
    """图邻域遍历"""

    results = []
    visited = set(seed_entity_ids)

    current_level = seed_entity_ids
    for d in range(depth):
        # 获取当前层所有实体的邻居
        neighbors = await supabase.from_("relates_to") \
            .select("target_entity_id, relation_type, weight") \
            .in_("source_entity_id", current_level) \
            .eq("user_id", user_id) \
            .execute()

        next_level = []
        for rel in neighbors.data:
            if rel["target_entity_id"] not in visited:
                visited.add(rel["target_entity_id"])
                next_level.append(rel["target_entity_id"])

                # 分数随深度衰减
                score = rel["weight"] * (0.7 ** d)
                results.append(SearchResult(
                    entity_id=rel["target_entity_id"],
                    score=score,
                    source="graph",
                    relation_type=rel["relation_type"],
                    depth=d + 1
                ))

        current_level = next_level[:max_neighbors]

    # 获取实体详情
    entity_ids = [r.entity_id for r in results]
    entities = await knowledge_service.get_entities_by_ids(entity_ids)
    entity_map = {e.id: e for e in entities}

    for result in results:
        entity = entity_map.get(result.entity_id)
        if entity:
            result.name = entity.name
            result.description = entity.description
            result.entity_type = entity.entity_type

    return results
```

---

## 分数融合算法

### 权重配置

```python
@dataclass
class FusionWeights:
    vector: float = 0.5   # 向量搜索权重
    fts: float = 0.3      # 全文搜索权重
    graph: float = 0.2    # 图遍历权重
```

### 归一化

```python
def normalize_scores(results: list[SearchResult]) -> list[SearchResult]:
    """Min-Max 归一化"""
    if not results:
        return results

    scores = [r.score for r in results]
    min_score = min(scores)
    max_score = max(scores)

    if max_score == min_score:
        for r in results:
            r.normalized_score = 1.0
    else:
        for r in results:
            r.normalized_score = (r.score - min_score) / (max_score - min_score)

    return results
```

### 融合实现

```python
async def hybrid_search(
    query: str,
    user_id: str,
    weights: FusionWeights = FusionWeights(),
    top_k: int = 10
) -> list[SearchResult]:
    """混合检索"""

    # 1. 生成查询嵌入
    query_embedding = await embedding_service.embed(query)

    # 2. 并行执行三路搜索
    vector_results, fts_results = await asyncio.gather(
        vector_search(query_embedding, user_id, top_k=20),
        fulltext_search(query, user_id, top_k=20)
    )

    # 3. 从向量搜索高分实体进行图遍历
    seed_ids = [r.entity_id for r in vector_results[:5]]
    graph_results = await graph_traversal(seed_ids, user_id, depth=2)

    # 4. 归一化各路分数
    vector_results = normalize_scores(vector_results)
    fts_results = normalize_scores(fts_results)
    graph_results = normalize_scores(graph_results)

    # 5. 融合分数
    entity_scores: dict[str, FusedResult] = {}

    # 向量分数
    for r in vector_results:
        if r.entity_id not in entity_scores:
            entity_scores[r.entity_id] = FusedResult(r)
        entity_scores[r.entity_id].vector_score = r.normalized_score

    # 全文分数
    for r in fts_results:
        if r.entity_id not in entity_scores:
            entity_scores[r.entity_id] = FusedResult(r)
        entity_scores[r.entity_id].fts_score = r.normalized_score

    # 图分数
    for r in graph_results:
        if r.entity_id not in entity_scores:
            entity_scores[r.entity_id] = FusedResult(r)
        entity_scores[r.entity_id].graph_score = r.normalized_score

    # 6. 计算最终分数
    for fused in entity_scores.values():
        fused.final_score = (
            weights.vector * fused.vector_score +
            weights.fts * fused.fts_score +
            weights.graph * fused.graph_score
        )

        # 多信号奖励：≥2个信号同时命中
        signals = sum([
            fused.vector_score > 0,
            fused.fts_score > 0,
            fused.graph_score > 0
        ])
        if signals >= 2:
            fused.final_score += 0.02 * (signals - 1)

    # 7. 排序返回
    sorted_results = sorted(
        entity_scores.values(),
        key=lambda x: x.final_score,
        reverse=True
    )

    return sorted_results[:top_k]
```

---

## 服务层设计

```python
# backend/app/services/retrieval/hybrid.py

class HybridRetrievalService:
    def __init__(self, supabase: Client, embedding_service: EmbeddingService):
        self.supabase = supabase
        self.embedding_service = embedding_service

    async def search(
        self,
        query: str,
        user_id: str,
        options: SearchOptions = SearchOptions()
    ) -> SearchResponse:
        """执行混合检索"""

        start_time = time.time()

        # 执行混合搜索
        results = await hybrid_search(
            query=query,
            user_id=user_id,
            weights=options.weights,
            top_k=options.top_k
        )

        # 可选：重排序
        if options.rerank:
            results = await self.rerank(query, results)

        search_time = (time.time() - start_time) * 1000

        return SearchResponse(
            results=results,
            total=len(results),
            query=query,
            searchTimeMs=search_time
        )

    async def rerank(
        self,
        query: str,
        results: list[FusedResult],
        top_k: int = 10
    ) -> list[FusedResult]:
        """使用交叉编码器重排序"""
        # 简化实现：使用LLM评分
        # 生产环境可使用 sentence-transformers 的 CrossEncoder

        for result in results:
            text = f"{result.name}: {result.description or ''}"
            # 这里可以调用 LLM 或本地模型进行相关性评分
            # result.rerank_score = await evaluate_relevance(query, text)

        return sorted(results, key=lambda x: x.final_score, reverse=True)[:top_k]
```

---

## API 端点

### 搜索请求

```http
POST /api/knowledge/entities/search
Content-Type: application/json

{
  "query": "Rust内存安全特性",
  "topK": 10,
  "weights": {
    "vector": 0.5,
    "fts": 0.3,
    "graph": 0.2
  },
  "filters": {
    "entityTypes": ["concept", "tool"],
    "createdAfter": "2024-01-01"
  },
  "includeRelated": true,
  "rerank": false
}
```

### 搜索响应

```json
{
  "results": [
    {
      "entity": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "所有权系统",
        "description": "Rust的核心内存管理机制...",
        "entityType": "concept"
      },
      "scores": {
        "vector": 0.92,
        "fts": 0.85,
        "graph": 0.60,
        "final": 0.81
      },
      "sources": ["vector", "fts", "graph"],
      "relatedEntities": [
        {
          "entity": {"id": "...", "name": "借用检查器"},
          "relationType": "part_of"
        }
      ]
    }
  ],
  "total": 10,
  "query": "Rust内存安全特性",
  "searchTimeMs": 156
}
```

---

## 性能优化

### 索引优化

```sql
-- 确保 HNSW 索引参数合适
-- m: 每个节点的连接数 (16-64)
-- ef_construction: 构建时搜索宽度 (64-200)

CREATE INDEX idx_knowledge_entity_embedding ON knowledge_entity
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 查询时可调整 ef_search
SET hnsw.ef_search = 100;  -- 更高的值 = 更准确但更慢
```

### 查询优化

1. **并行执行**: 向量和全文搜索并行执行
2. **结果缓存**: 热门查询结果缓存 5 分钟
3. **分页**: 支持游标分页，避免深度分页
4. **预计算**: 高频实体的图邻域可预计算

---

## 下一步

继续阅读 `05-conversation.md` 了解对话系统的详细规格。
