# AI 功能调用指南

本文档为后端开发者提供 SaveHub 项目中 AI 功能的完整调用指南。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      API 配置管理                            │
│  api_configs 表 (chat / embedding / rerank)                 │
│  加密存储: api_key, api_base                                 │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│      Chat API           │     │    Embedding API        │
│  ai_service.py          │     │  rag/embedder.py        │
│  - 仓库分析             │     │  - 文本向量化           │
│  - OpenAI 兼容          │     │  - 批量处理             │
└─────────────────────────┘     └─────────────────────────┘
```

## 环境配置

### 必需环境变量

```bash
# .env 文件
ENCRYPTION_SECRET=your-secret-key-at-least-32-chars  # 加密密钥（至少32字符）
```

生成加密密钥：
```bash
openssl rand -base64 32
```

### 依赖安装

```bash
pip install openai httpx cryptography
```

## 快速上手

### 1. Chat API 调用

```python
from app.services.ai_service import AIService

# 初始化服务
service = AIService(
    api_key="sk-xxx",
    api_base="https://api.openai.com/v1",
    model="gpt-4"
)

# 分析仓库
result = await service.analyze_repository(
    readme_content="# My Project\n...",
    repo_name="owner/repo",
    description="A cool project"
)
# 返回: {"ai_summary": "...", "ai_tags": [...], "ai_platforms": [...]}
```

### 2. Embedding API 调用

```python
from app.services.rag.embedder import embed_text, embed_texts

# 单文本嵌入
vector = embed_text(
    text="Hello world",
    api_key="sk-xxx",
    api_base="https://api.openai.com/v1",
    model="text-embedding-3-small"
)
# 返回: List[float] (1536维向量)

# 批量嵌入
vectors = embed_texts(
    texts=["Hello", "World"],
    api_key="sk-xxx",
    api_base="https://api.openai.com/v1",
    model="text-embedding-3-small",
    batch_size=100
)
# 返回: List[List[float]]
```

### 3. 从数据库配置创建服务

```python
from app.services.ai_service import create_ai_service_from_config
from app.services.db.api_configs import ApiConfigService

# 获取活跃配置
config_service = ApiConfigService(supabase_client, user_id)
config = await config_service.get_active_config("chat")

# 创建服务（自动解密）
service = create_ai_service_from_config(config)
```

## 文档索引

| 文档 | 内容 |
|------|------|
| [api-configs.md](./api-configs.md) | API 配置管理（数据结构、CRUD、加密） |
| [chat-api.md](./chat-api.md) | Chat API 调用详解 |
| [embedding-api.md](./embedding-api.md) | Embedding API 调用详解 |
| [troubleshooting.md](./troubleshooting.md) | 常见问题排查 |

## 源文件参考

| 功能 | 文件路径 |
|------|---------|
| 数据库 Schema | `backend/scripts/017_create_api_configs.sql` |
| Pydantic 模型 | `backend/app/schemas/api_configs.py` |
| 配置服务 | `backend/app/services/db/api_configs.py` |
| API 路由 | `backend/app/api/routers/api_configs.py` |
| 加密服务 | `backend/app/services/encryption.py` |
| Chat 服务 | `backend/app/services/ai_service.py` |
| Embedding 服务 | `backend/app/services/rag/embedder.py` |
