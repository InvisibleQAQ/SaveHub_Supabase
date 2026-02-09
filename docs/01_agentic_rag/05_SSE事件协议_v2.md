# SSE 事件协议 v2（/api/agentic-rag/stream）

本协议用于前后端对齐 Agentic-RAG 流式事件。

## 1. 基础格式

```text
event: <event_name>
data: <json_string>
```

---

## 2. 事件定义

## `rewrite`

表示查询改写/拆分阶段结果。

```json
{
  "original_query": "原始问题",
  "rewritten_queries": ["子问题1", "子问题2"],
  "count": 2
}
```

## `clarification_required`

问题不清晰，需要用户补充。

```json
{
  "message": "请问你想比较的是性能、成本还是易用性？"
}
```

## `tool_call`

Agent 正在调用工具。

```json
{
  "question_index": 0,
  "tool_name": "search_embeddings",
  "args": {
    "query": "...",
    "top_k": 8
  }
}
```

## `tool_result`

工具调用返回。

```json
{
  "question_index": 0,
  "tool_name": "search_embeddings",
  "result_count": 6,
  "sources": [
    {
      "id": "uuid",
      "index": 1,
      "content": "...",
      "score": 0.88,
      "source_type": "article",
      "title": "...",
      "url": "..."
    }
  ]
}
```

## `aggregation`

多子问题答案聚合阶段。

```json
{
  "total_questions": 2,
  "completed": 2
}
```

## `content`

增量回答内容（与旧协议一致）。

```json
{
  "delta": "文本片段"
}
```

## `done`

回答完成。

```json
{
  "message": "completed",
  "sources": []
}
```

## `error`

错误事件。

```json
{
  "message": "错误描述"
}
```

---

## 3. 与现有引用系统兼容规则

1. `content` 中引用继续使用 `[ref:N]`
2. `sources[].index` 必须与 `[ref:N]` 的 `N` 对齐
3. `N` 从 1 开始，单次回答内全局唯一
4. 若多子问题聚合，引用索引必须在聚合前重排去重

---

## 4. 最小前端兼容子集

即使未完成所有事件 UI，也必须至少支持：

- `content`
- `done`
- `error`
- `clarification_required`

