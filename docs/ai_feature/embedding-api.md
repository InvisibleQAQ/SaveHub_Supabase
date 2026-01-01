# Embedding API 调用指南

使用 OpenAI 兼容 API 将文本转换为向量。

## 核心函数

### embed_text - 单文本嵌入

```python
from app.services.rag.embedder import embed_text

vector = embed_text(
    text="Hello world",
    api_key="sk-xxx",
    api_base="https://api.openai.com/v1",
    model="text-embedding-3-small"
)
# 返回: List[float] (1536 维向量)
```

**参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| text | str | 输入文本（不能为空） |
| api_key | str | API 密钥 |
| api_base | str | API 基础 URL |
| model | str | 模型名称 |

**异常**:
- `EmbeddingError`: 文本为空或 API 调用失败

### embed_texts - 批量嵌入

```python
from app.services.rag.embedder import embed_texts

vectors = embed_texts(
    texts=["Hello", "World", "Test"],
    api_key="sk-xxx",
    api_base="https://api.openai.com/v1",
    model="text-embedding-3-small",
    batch_size=100  # 可选，默认 100
)
# 返回: List[List[float]]
```

**特性**:
- 自动过滤空文本（返回空列表占位）
- 分批处理减少 API 调用
- 保持输入输出顺序一致

## 配置参数

```python
# embedder.py 中的默认配置
DEFAULT_TIMEOUT = httpx.Timeout(60.0, connect=30.0)  # 总超时60s，连接30s
DEFAULT_MAX_RETRIES = 3                               # 自动重试次数
DEFAULT_BATCH_SIZE = 100                              # 每批文本数
MAX_TOKENS_PER_BATCH = 8000                           # 每批最大token数
```

## URL 规范化

自动处理常见的 URL 配置错误：

| 输入 | 规范化后 |
|------|---------|
| `xxx/v1/embeddings` | `xxx/v1` |
| `xxx/v1/chat/completions` | `xxx/v1` |
| `api.openai.com/v1` | `https://api.openai.com/v1` |

## 辅助函数

### estimate_token_count

估算文本的 token 数量：

```python
from app.services.rag.embedder import estimate_token_count

tokens = estimate_token_count("你好世界 Hello")
# 中文约 1.5 字/token，英文约 4 字符/token
```

### chunk_texts_for_embedding

按 token 数量分组文本：

```python
from app.services.rag.embedder import chunk_texts_for_embedding

batches = chunk_texts_for_embedding(texts, max_tokens_per_batch=8000)
# 返回: [[0, 1, 2], [3, 4], ...]  # 索引分组
```
