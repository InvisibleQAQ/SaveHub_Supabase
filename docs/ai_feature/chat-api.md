# Chat API 调用指南

使用 OpenAI 兼容 API 进行对话和文本分析。

## AIService 类

### 初始化

```python
from app.services.ai_service import AIService

service = AIService(
    api_key="sk-xxx",
    api_base="https://api.openai.com/v1",
    model="gpt-4"
)
```

### 从配置创建（推荐）

```python
from app.services.ai_service import create_ai_service_from_config

# config 来自数据库，自动处理解密
service = create_ai_service_from_config(config)
```

## 核心方法

### analyze_repository

分析 GitHub 仓库，提取摘要、标签和平台信息。

```python
result = await service.analyze_repository(
    readme_content="# My Project\n...",
    repo_name="owner/repo",
    description="Optional description"
)
```

**返回值**:
```python
{
    "ai_summary": "这是一个...",      # 中文摘要 (50-100字)
    "ai_tags": ["React", "TypeScript"],  # 技术标签 (3-5个)
    "ai_platforms": ["Web", "Macos"]     # 支持平台
}
```

**支持的平台值**: `Windows`, `Macos`, `Linux`, `Ios`, `Android`, `Web`, `Cli`, `Docker`

### analyze_repositories_batch

批量分析多个仓库，支持并发控制和进度回调。

```python
results = await service.analyze_repositories_batch(
    repos=[
        {"id": "1", "full_name": "owner/repo1", "readme_content": "...", "language": "Python"},
        {"id": "2", "full_name": "owner/repo2", "readme_content": "...", "language": "JavaScript"},
    ],
    concurrency=5,        # 最大并发数
    use_fallback=True,    # AI 失败时使用降级分析
    on_progress=async_callback  # 可选进度回调
)
```

**返回值**:
```python
{
    "1": {"success": True, "data": {...}},
    "2": {"success": True, "data": {...}, "fallback": True}  # 降级分析
}
```

### fallback_analysis

当 AI API 不可用或无 README 时的降级分析。

```python
result = service.fallback_analysis({
    "name": "my-cli-tool",
    "description": "A command line tool",
    "language": "Go"
})
# 返回: {"ai_summary": "", "ai_tags": [], "ai_platforms": ["Linux", "Macos", "Windows", "Cli"]}
```

## httpx 直接调用

如需自定义请求，可直接使用 httpx：

```python
import httpx

async with httpx.AsyncClient(timeout=90.0) as client:
    response = await client.post(
        f"{api_base}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Hello!"},
            ],
            "temperature": 0.3,
            "max_tokens": 2048,
        },
    )
    data = response.json()
    content = data["choices"][0]["message"]["content"]
```

## URL 规范化

AIService 会自动规范化 `api_base`：

| 输入 | 规范化后 |
|------|---------|
| `https://api.openai.com/v1/chat/completions` | `https://api.openai.com/v1` |
| `https://api.openai.com/v1/` | `https://api.openai.com/v1` |
| `api.openai.com/v1` | `https://api.openai.com/v1` |

## 错误处理

```python
try:
    result = await service.analyze_repository(...)
except httpx.TimeoutException:
    # 超时（默认 90 秒）
    pass
except httpx.RequestError as e:
    # 网络错误
    pass
except Exception as e:
    # 其他错误（API 返回非 200、JSON 解析失败等）
    pass
```
