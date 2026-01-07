# AI 功能开发指南

本指南帮助开发者在 SaveHub 项目中正确调用 AI 大模型。

## 目录

1. [快速开始](#快速开始)
2. [核心概念](#核心概念)
3. [使用场景](#使用场景)
4. [完整示例](#完整示例)
5. [常见问题](#常见问题)

---

## 快速开始

### 30秒上手

```python
from app.services.ai import ChatClient, EmbeddingClient, get_active_config

# 1. 获取配置（自动解密、自动规范化URL）
chat_config = get_active_config(supabase, user_id, "chat")
embedding_config = get_active_config(supabase, user_id, "embedding")

# 2. 创建客户端
chat = ChatClient(**chat_config)
embedding = EmbeddingClient(**embedding_config)

# 3. 调用
response = await chat.complete([{"role": "user", "content": "你好"}])
vector = await embedding.embed("Hello world")
```

就这么简单。不需要手动解密、不需要处理URL格式、不需要直接操作OpenAI SDK。

---

## 核心概念

### 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    你的业务代码                          │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              app.services.ai 模块                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ ChatClient  │  │EmbeddingClient│ │ RerankClient│     │
│  │  - complete │  │  - embed     │  │  (预留)     │     │
│  │  - stream   │  │  - embed_batch│ │             │     │
│  │  - vision   │  │              │  │             │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                           │                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │              config.py                           │   │
│  │  - get_active_config()  获取解密后的配置          │   │
│  │  - normalize_base_url() URL规范化                │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   api_configs 表                         │
│         (加密存储 api_key, api_base, model)              │
└─────────────────────────────────────────────────────────┘
```

### 三个客户端

| 客户端 | 用途 | 配置类型 |
|--------|------|----------|
| `ChatClient` | 对话、问答、Vision图片描述 | `chat` |
| `EmbeddingClient` | 文本向量化（用于RAG检索） | `embedding` |
| `RerankClient` | 重排序（暂未实现） | `rerank` |

### 配置自动处理

你**不需要**关心：
- API Key 的加密/解密（自动处理）
- URL 格式差异（自动规范化为 `/v1` 结尾）
- OpenAI SDK 的初始化细节

你**只需要**：
1. 调用 `get_active_config()` 获取配置
2. 用配置创建客户端
3. 调用客户端方法

---

## 使用场景

### 场景1：普通对话

```python
from app.services.ai import ChatClient, get_active_config

async def ask_ai(supabase, user_id: str, question: str) -> str:
    """向AI提问并获取回答"""
    config = get_active_config(supabase, user_id, "chat")
    if not config:
        raise ValueError("用户未配置Chat API")

    chat = ChatClient(**config)

    messages = [
        {"role": "system", "content": "你是一个有帮助的助手。"},
        {"role": "user", "content": question}
    ]

    return await chat.complete(messages)
```

### 场景2：流式输出

适用于需要实时显示生成内容的场景（如聊天界面）：

```python
from app.services.ai import ChatClient, get_active_config

async def stream_response(supabase, user_id: str, messages: list):
    """流式生成回复"""
    config = get_active_config(supabase, user_id, "chat")
    chat = ChatClient(**config)

    async for chunk in chat.stream(messages):
        yield chunk  # 每次返回一小段文本
```

在 FastAPI 中使用：

```python
from fastapi.responses import StreamingResponse

@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    async def generate():
        async for chunk in stream_response(supabase, user_id, request.messages):
            yield f"data: {chunk}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

### 场景3：图片描述（Vision）

```python
from app.services.ai import ChatClient, get_active_config

async def describe_image(supabase, user_id: str, image_url: str) -> str:
    """生成图片描述"""
    config = get_active_config(supabase, user_id, "chat")  # Vision 共用 chat 配置
    chat = ChatClient(**config)

    # 方式1：可能抛出异常
    caption = await chat.vision_caption(image_url)

    # 方式2：失败返回 None（推荐用于批量处理）
    caption = await chat.vision_caption_safe(image_url)

    return caption
```

**注意**：Vision 功能需要模型支持（如 GPT-4V、Qwen-VL 等）。

### 场景4：文本向量化

```python
from app.services.ai import EmbeddingClient, get_active_config

async def vectorize_text(supabase, user_id: str, text: str) -> list[float]:
    """将文本转换为向量"""
    config = get_active_config(supabase, user_id, "embedding")
    embedding = EmbeddingClient(**config)

    return await embedding.embed(text)
```

### 场景5：批量向量化

处理大量文本时，使用批量接口更高效：

```python
from app.services.ai import EmbeddingClient, get_active_config

async def vectorize_articles(supabase, user_id: str, texts: list[str]) -> list[list[float]]:
    """批量向量化文章"""
    config = get_active_config(supabase, user_id, "embedding")
    embedding = EmbeddingClient(**config)

    # 自动分批处理，默认每批100条
    vectors = await embedding.embed_batch(texts, batch_size=50)

    return vectors
```

### 场景6：在 Celery 任务中使用

Celery 任务是同步的，需要用 `asyncio.run()` 包装：

```python
import asyncio
from app.celery_app import celery_app
from app.services.ai import ChatClient, get_active_config

@celery_app.task
def analyze_article_task(user_id: str, article_content: str):
    """Celery任务：分析文章"""

    async def _analyze():
        supabase = get_supabase_client()  # 获取 Supabase 客户端
        config = get_active_config(supabase, user_id, "chat")

        if not config:
            return {"error": "未配置AI"}

        chat = ChatClient(**config)
        summary = await chat.complete([
            {"role": "system", "content": "请总结以下文章的要点。"},
            {"role": "user", "content": article_content}
        ])
        return {"summary": summary}

    return asyncio.run(_analyze())
```

---

## 完整示例

### 示例：RAG 问答服务

```python
"""
RAG问答服务示例
结合向量检索和AI生成
"""
from app.services.ai import (
    ChatClient,
    EmbeddingClient,
    get_active_config,
    ChatError,
    EmbeddingError,
)

class RAGService:
    def __init__(self, supabase, user_id: str):
        self.supabase = supabase
        self.user_id = user_id
        self._chat = None
        self._embedding = None

    async def _get_chat(self) -> ChatClient:
        if not self._chat:
            config = get_active_config(self.supabase, self.user_id, "chat")
            if not config:
                raise ValueError("请先配置Chat API")
            self._chat = ChatClient(**config)
        return self._chat

    async def _get_embedding(self) -> EmbeddingClient:
        if not self._embedding:
            config = get_active_config(self.supabase, self.user_id, "embedding")
            if not config:
                raise ValueError("请先配置Embedding API")
            self._embedding = EmbeddingClient(**config)
        return self._embedding

    async def answer(self, question: str) -> str:
        """基于知识库回答问题"""
        try:
            # 1. 将问题向量化
            embedding = await self._get_embedding()
            query_vector = await embedding.embed(question)

            # 2. 检索相关文档（假设有 search_documents 函数）
            docs = await self.search_documents(query_vector, top_k=5)

            # 3. 构建上下文
            context = "\n\n".join([doc["content"] for doc in docs])

            # 4. 生成回答
            chat = await self._get_chat()
            messages = [
                {
                    "role": "system",
                    "content": f"基于以下资料回答用户问题。如果资料中没有相关信息，请说明。\n\n资料：\n{context}"
                },
                {"role": "user", "content": question}
            ]

            return await chat.complete(messages, temperature=0.3)

        except EmbeddingError as e:
            return f"向量化失败：{e}"
        except ChatError as e:
            return f"生成回答失败：{e}"

    async def search_documents(self, vector: list[float], top_k: int) -> list[dict]:
        """向量检索（示例）"""
        # 实际实现应调用 pgvector 或其他向量数据库
        response = self.supabase.rpc(
            "match_documents",
            {"query_embedding": vector, "match_count": top_k}
        ).execute()
        return response.data or []
```

---

## 常见问题

### Q1: 用户没有配置API怎么办？

`get_active_config()` 在找不到配置时返回 `None`，你需要处理这种情况：

```python
config = get_active_config(supabase, user_id, "chat")
if not config:
    raise HTTPException(status_code=400, detail="请先在设置中配置AI API")
```

### Q2: 如何处理API调用失败？

使用 try-except 捕获特定异常：

```python
from app.services.ai import ChatClient, ChatError, EmbeddingError

try:
    response = await chat.complete(messages)
except ChatError as e:
    logger.error(f"AI调用失败: {e}")
    # 处理错误...
```

### Q3: URL格式有什么要求？

**你不需要关心**。用户输入的任何格式都会被自动规范化：

```
用户输入                                    → 实际使用
https://api.openai.com/v1/chat/completions → https://api.openai.com/v1
https://api.example.com                    → https://api.example.com/v1
api.example.com/v1                         → https://api.example.com/v1
```

### Q4: Vision和Chat用同一个配置吗？

是的。Vision（图片描述）使用 `chat` 类型的配置，因为它本质上是 Chat Completion API 的多模态扩展。

### Q5: 如何调整超时时间？

当前使用默认配置（90秒超时，3次重试）。如需自定义，可以修改 `clients.py` 中的常量：

```python
# clients.py
DEFAULT_TIMEOUT = httpx.Timeout(90.0, connect=30.0)
DEFAULT_MAX_RETRIES = 3
```

### Q6: 支持哪些模型？

任何兼容 OpenAI API 格式的模型都可以使用，包括：
- OpenAI (GPT-4, GPT-3.5)
- Azure OpenAI
- 通义千问 (Qwen)
- 智谱 (GLM)
- DeepSeek
- 本地部署的 Ollama、vLLM 等

---

## 模块位置

```
backend/app/services/ai/
├── __init__.py           # 公共接口（从这里导入）
├── config.py             # 配置管理
├── clients.py            # AI客户端
├── repository_service.py # 仓库分析服务（业务示例）
└── CLAUDE.md             # 模块文档
```

## 导入速查

```python
# 推荐：从 __init__.py 导入
from app.services.ai import (
    # 客户端
    ChatClient,
    EmbeddingClient,
    RerankClient,        # 预留，暂未实现

    # 配置函数
    get_active_config,   # 获取单个配置
    get_user_ai_configs, # 获取所有配置
    normalize_base_url,  # URL规范化（通常不需要直接调用）

    # 异常
    ChatError,
    EmbeddingError,
    ConfigError,

    # 常量
    CAPTION_PROMPT,      # 默认图片描述提示词
)
```

---

## 添加新功能检查清单

当你需要添加新的AI功能时：

- [ ] 使用 `get_active_config()` 获取配置，不要自己查数据库
- [ ] 使用 `ChatClient` 或 `EmbeddingClient`，不要直接用 OpenAI SDK
- [ ] 处理配置不存在的情况（返回 `None`）
- [ ] 捕获 `ChatError` / `EmbeddingError` 异常
- [ ] 在 Celery 任务中用 `asyncio.run()` 包装异步调用
- [ ] 批量处理时使用 `embed_batch()` 而非循环调用 `embed()`
