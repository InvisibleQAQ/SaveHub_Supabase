# 常见问题排查

## 环境变量问题

### ENCRYPTION_SECRET 未设置

**错误信息**:
```
ValueError: ENCRYPTION_SECRET is not set. Generate one with: openssl rand -base64 32
```

**解决方案**:
```bash
# 生成密钥
openssl rand -base64 32

# 添加到 .env
ENCRYPTION_SECRET=your-generated-key-here
```

### ENCRYPTION_SECRET 长度不足

**错误信息**:
```
ValueError: ENCRYPTION_SECRET must be at least 32 characters
```

**解决方案**: 确保密钥至少 32 个字符。

## URL 配置问题

### 404 Not Found

**原因**: `api_base` 包含了端点路径

**错误配置**:
```
api_base = "https://api.openai.com/v1/chat/completions"
```

**正确配置**:
```
api_base = "https://api.openai.com/v1"
```

### Connection Error

**原因**: URL 缺少协议前缀

**错误配置**:
```
api_base = "api.openai.com/v1"
```

**正确配置**:
```
api_base = "https://api.openai.com/v1"
```

## 加密/解密问题

### 解密失败

**错误信息**:
```
ValueError: Decryption failed
```

**可能原因**:
1. `ENCRYPTION_SECRET` 与加密时不一致
2. 数据未加密但尝试解密

**解决方案**:
```python
try:
    api_key = decrypt(api_key)
except Exception:
    pass  # 使用原值
```

## 超时问题

### Chat API 超时

**默认超时**: 90 秒

**解决方案**:
```python
async with httpx.AsyncClient(timeout=120.0) as client:
    # 增加超时时间
    ...
```

### Embedding API 超时

**默认超时**: 60 秒（连接 30 秒）

**解决方案**: 减少批量大小
```python
vectors = embed_texts(texts, ..., batch_size=50)
```

## 调试技巧

### 启用日志

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

### 验证 API 配置

```python
# 使用验证端点
POST /api-configs/validate
{
    "api_key": "sk-xxx",
    "api_base": "https://api.openai.com/v1",
    "model": "gpt-4",
    "type": "chat"
}
```

### 检查加密状态

```python
from app.services.encryption import is_encrypted

if is_encrypted(api_key):
    print("API key is encrypted")
else:
    print("API key is plaintext")
```
