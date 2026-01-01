# API 配置管理

管理 Chat、Embedding、Rerank 三种 API 配置，支持加密存储和用户隔离。

## 数据结构

### 数据库表 (api_configs)

```sql
CREATE TABLE public.api_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- 配置名称（如 "OpenAI GPT-4"）
  api_key TEXT NOT NULL,           -- 加密存储
  api_base TEXT NOT NULL,          -- 加密存储
  model TEXT NOT NULL,             -- 模型名称
  type TEXT NOT NULL DEFAULT 'chat',  -- chat / embedding / rerank
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT api_configs_type_check CHECK (type IN ('chat', 'embedding', 'rerank'))
);

-- 每种类型只能有一个活跃配置
CREATE UNIQUE INDEX idx_api_configs_single_active_per_type
  ON api_configs(user_id, type) WHERE is_active = TRUE;
```

### 类型定义

```python
# backend/app/schemas/api_configs.py
from typing import Literal

ApiConfigType = Literal["chat", "embedding", "rerank"]
```

## CRUD 操作

### 服务类初始化

```python
from app.services.db.api_configs import ApiConfigService

service = ApiConfigService(supabase_client, user_id)
```

### 加载配置

```python
# 加载所有配置
configs = await service.load_api_configs()

# 按类型过滤
chat_configs = await service.load_api_configs(config_type="chat")
```

### 获取活跃配置

```python
# 获取某类型的活跃配置（最常用）
config = await service.get_active_config("chat")
config = await service.get_active_config("embedding")
```

### 创建配置

```python
from app.schemas.api_configs import ApiConfigCreate

new_config = ApiConfigCreate(
    name="OpenAI GPT-4",
    api_key="sk-xxx",
    api_base="https://api.openai.com/v1",
    model="gpt-4",
    type="chat",
    is_active=True
)
created = await service.create_api_config(new_config)
# 注意：创建时会自动停用同类型的其他配置
```

### 更新配置

```python
from app.schemas.api_configs import ApiConfigUpdate

updates = ApiConfigUpdate(model="gpt-4-turbo")
updated = await service.update_api_config(config_id, updates)
```

### 激活配置

```python
# 激活指定配置（自动停用同类型其他配置）
await service.set_active_config(config_id)
```

### 删除配置

```python
await service.delete_api_config(config_id)
```

## 加密/解密机制

### 算法参数

| 参数 | 值 |
|------|-----|
| 算法 | AES-256-GCM |
| 密钥派生 | PBKDF2-SHA256 |
| 盐值 | `rssreader-salt` (固定) |
| 迭代次数 | 100000 |
| IV 长度 | 12 字节 |
| 存储格式 | base64(iv + ciphertext) |

### 使用方式

```python
from app.services.encryption import encrypt, decrypt, is_encrypted

# 加密
encrypted = encrypt("sk-xxx")  # -> base64 字符串

# 解密
decrypted = decrypt(encrypted)  # -> "sk-xxx"

# 检查是否已加密
if is_encrypted(data):
    data = decrypt(data)
```

### 自动解密模式

从数据库读取配置时，推荐使用 try-except 模式：

```python
api_key = config["api_key"]
try:
    api_key = decrypt(api_key)
except Exception:
    pass  # 未加密或解密失败，使用原值
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api-configs` | 获取所有配置 |
| GET | `/api-configs/grouped` | 按类型分组获取 |
| GET | `/api-configs/active/{type}` | 获取活跃配置 |
| POST | `/api-configs` | 创建配置 |
| PUT | `/api-configs/{id}` | 更新配置 |
| DELETE | `/api-configs/{id}` | 删除配置 |
| POST | `/api-configs/{id}/activate` | 激活配置 |
| POST | `/api-configs/validate` | 验证 API 凭证 |
