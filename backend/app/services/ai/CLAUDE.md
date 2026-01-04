# AI Services Module

统一的AI服务模块，提供Chat、Embedding、Vision等AI能力的统一接口。

## 文件结构

```
services/ai/
├── __init__.py    # 公共接口导出
├── config.py      # URL规范化 + 配置获取解密
├── clients.py     # ChatClient + EmbeddingClient
└── CLAUDE.md      # 本文档
```

## 核心组件

### config.py

| 函数 | 功能 |
|------|------|
| `normalize_base_url(url)` | 规范化api_base为OpenAI SDK格式（以/v1结尾） |
| `get_decrypted_config(config)` | 解密api_key和api_base，规范化URL |
| `get_user_ai_configs(supabase, user_id)` | 获取用户所有激活的AI配置 |
| `get_active_config(supabase, user_id, type)` | 获取指定类型的激活配置 |

### clients.py

| 类 | 功能 |
|------|------|
| `ChatClient` | Chat Completion（含Vision） |
| `EmbeddingClient` | 文本向量化 |
| `RerankClient` | 重排序（预留接口） |

## 使用示例

```python
from app.services.ai import (
    ChatClient,
    EmbeddingClient,
    get_user_ai_configs,
)

# 获取配置
configs = get_user_ai_configs(supabase, user_id)

# 创建客户端
chat = ChatClient(**configs["chat"])
embedding = EmbeddingClient(**configs["embedding"])

# Chat Completion
response = await chat.complete([{"role": "user", "content": "Hello"}])

# 流式对话
async for chunk in chat.stream(messages):
    print(chunk, end="")

# Vision（图片描述）
caption = await chat.vision_caption(image_url)

# Embedding
vector = await embedding.embed("Hello world")
vectors = await embedding.embed_batch(["Hello", "World"])
```

## URL规范化规则

`normalize_base_url()` 将各种格式的api_base转换为OpenAI SDK需要的格式：

```
输入 → 输出
https://api.example.com/v1/chat/completions → https://api.example.com/v1
https://api.example.com/v1/embeddings → https://api.example.com/v1
https://api.example.com → https://api.example.com/v1
api.example.com/v1 → https://api.example.com/v1
```

## 配置来源

配置存储在 `api_configs` 表，支持三种类型：
- `chat` - Chat Completion API（也用于Vision）
- `embedding` - Embedding API
- `rerank` - Rerank API（预留）

敏感字段（api_key, api_base）使用AES-256-GCM加密存储。

## 错误处理

| 异常 | 场景 |
|------|------|
| `ConfigError` | 配置不存在或不完整 |
| `ChatError` | Chat/Vision调用失败 |
| `EmbeddingError` | Embedding生成失败 |
