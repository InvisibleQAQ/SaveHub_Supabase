# Repository 同步按钮 AI 调用流程

本文档详细记录从前端 `/repository` 页面点击同步按钮到后端调用 Chat API 的完整代码链路。

## 调用链概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  前端 (Next.js)                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. repository-page.tsx    →  handleSync() 点击同步按钮                      │
│  2. repositories.slice.ts  →  syncRepositories() Zustand action             │
│  3. repositories.ts (api)  →  syncWithProgress() 发送 POST 请求             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ POST /api/repositories/sync (SSE)
┌─────────────────────────────────────────────────────────────────────────────┐
│  后端 (FastAPI)                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  4. repositories.py        →  sync_repositories() SSE 端点                  │
│  5. repository_analyzer.py →  analyze_repositories_needing_analysis()       │
│  6. api_configs.py         →  get_active_config("chat") 获取配置            │
│  7. ai_service.py          →  AIService.analyze_repositories_batch()        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ POST /chat/completions
┌─────────────────────────────────────────────────────────────────────────────┐
│  外部 AI API (OpenAI 兼容)                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 1. 前端触发点

### 文件: `frontend/components/repository/repository-page.tsx`

```typescript
// 第 59-82 行
const handleSync = async () => {
  if (!settings.githubToken) {
    toast({
      title: "GitHub Token 未配置",
      description: "请在设置页面添加 GitHub Token",
      variant: "destructive",
    })
    return
  }

  try {
    const result = await syncRepositories()  // ← 调用 Zustand action
    toast({
      title: "同步完成",
      description: `共 ${result.total} 个仓库，新增 ${result.newCount} 个`,
    })
  } catch (error) {
    toast({
      title: "同步失败",
      description: error instanceof Error ? error.message : "未知错误",
      variant: "destructive",
    })
  }
}
```

**关键点**:
- 同步按钮在第 162-169 行渲染
- `syncRepositories` 来自 `useRSSStore()` hook

## 2. Zustand Store Action

### 文件: `frontend/lib/store/repositories.slice.ts`

```typescript
// 第 57-72 行
syncRepositories: async () => {
  set({ isSyncing: true, syncProgress: null })
  try {
    const result = await repositoriesApi.syncWithProgress((progress) => {
      set({ syncProgress: progress })  // ← 实时更新进度条
    })
    const repos = await repositoriesApi.getAll()
    set({
      repositories: repos,
      lastSyncedAt: new Date().toISOString(),
    })
    return result
  } finally {
    set({ isSyncing: false, syncProgress: null })
  }
}
```

**关键点**:
- 通过回调函数接收 SSE 进度事件
- 进度状态用于渲染进度条 UI

## 3. 前端 API 客户端

### 文件: `frontend/lib/api/repositories.ts`

```typescript
// 第 38-90 行
async syncWithProgress(
  onProgress: (progress: SyncProgressEvent) => void
): Promise<SyncResult> {
  const response = await fetch(`${API_BASE}/api/repositories/sync`, {
    method: "POST",
    credentials: "include",  // ← 携带 cookie (JWT)
  })

  // SSE 流式读取
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    // 解析 SSE 事件
    // event: progress / done / error
    // data: JSON
  }
}
```

**SSE 事件类型**:
| 事件 | 数据 | 说明 |
|------|------|------|
| `progress` | `{phase, total, current, completed}` | 同步进度 |
| `done` | `{total, new_count, updated_count}` | 同步完成 |
| `error` | `{message}` | 错误信息 |

**进度阶段 (phase)**:
1. `fetching` - 正在获取 GitHub starred
2. `fetched` - 获取完成
3. `analyzing` - AI 分析中
4. `saving` - 保存分析结果

## 4. 后端 SSE 端点

### 文件: `backend/app/api/routers/repositories.py`

```python
# 第 48-246 行
@router.post("/sync")
async def sync_repositories(request: Request, user=Depends(verify_auth)):
    """
    Sync starred repositories from GitHub.
    Returns SSE stream with progress updates.
    """
    access_token = request.cookies.get(COOKIE_NAME_ACCESS)
    supabase = get_supabase_client(access_token)
    user_id = user.user.id

    # 验证 GitHub token
    settings_service = SettingsService(supabase, user_id)
    settings = settings_service.load_settings()
    github_token = settings.get("github_token")

    # 创建进度队列用于 SSE
    progress_queue: asyncio.Queue = asyncio.Queue()

    async def sync_task():
        # Phase 1: 获取 GitHub starred repos
        starred_repos = await _fetch_all_starred_repos(github_token)

        # Phase 2: 获取需要更新 README 的仓库
        # ...

        # Phase 3: AI 分析 ← 关键调用点
        await analyze_repositories_needing_analysis(
            supabase=supabase,
            user_id=user_id,
            on_progress=on_progress,        # 分析进度回调
            on_save_progress=on_save_progress,  # 保存进度回调
        )

    # 返回 SSE 流
    return StreamingResponse(
        generate_events(),
        media_type="text/event-stream",
    )
```

**关键点**:
- 第 189-194 行调用 `analyze_repositories_needing_analysis()`
- 使用 `asyncio.Queue` 实现 SSE 进度推送
- 同步完成后自动调度下一次同步 (Celery)

## 5. AI 分析协调器

### 文件: `backend/app/services/repository_analyzer.py`

```python
# 第 19-104 行
async def analyze_repositories_needing_analysis(
    supabase,
    user_id: str,
    on_progress: Optional[Callable] = None,
    on_save_progress: Optional[Callable] = None,
) -> dict[str, Any]:
    """
    AI analyze all repositories that need analysis.
    """
    # 1. 获取用户的 active chat API 配置
    api_config_service = ApiConfigService(supabase, user_id)
    config = api_config_service.get_active_config("chat")  # ← 关键: 获取 chat 类型配置

    if not config:
        return {"skipped": True, "skip_reason": "no_config"}

    # 2. 获取需要分析的仓库
    repo_service = RepositoryService(supabase, user_id)
    repos_to_analyze = repo_service.get_repositories_needing_analysis()

    # 3. 创建 AI 服务并批量分析
    ai_service = create_ai_service_from_config(config)  # ← 从配置创建服务
    analysis_results = await ai_service.analyze_repositories_batch(
        repos=repos_to_analyze,
        concurrency=5,
        use_fallback=True,
        on_progress=on_progress,
    )

    # 4. 保存分析结果
    for repo_id, analysis in analysis_results.items():
        if analysis["success"]:
            repo_service.update_ai_analysis(repo_id, analysis["data"])
        else:
            repo_service.mark_analysis_failed(repo_id)

    return {"analyzed": analyzed, "failed": failed}
```

**需要分析的仓库条件**:
- `ai_summary` 为空
- `ai_tags` 为空
- `analysis_failed = true` (重试失败的)

## 6. API 配置服务

### 文件: `backend/app/services/db/api_configs.py`

```python
# 第 83-107 行
def get_active_config(self, config_type: str) -> Optional[dict]:
    """
    Get the active config for a specific type.

    Args:
        config_type: 'chat', 'embedding', or 'rerank'
    """
    response = self.supabase.table("api_configs") \
        .select("*") \
        .eq("user_id", self.user_id) \
        .eq("type", config_type) \
        .eq("is_active", True) \
        .single() \
        .execute()

    if response.data:
        return self._row_to_dict(response.data)
    return None
```

**api_configs 表结构**:
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `name` | string | 配置名称 (如 "OpenAI GPT-4") |
| `api_key` | string | 加密的 API Key |
| `api_base` | string | 加密的 API Base URL |
| `model` | string | 模型名称 |
| `type` | string | 类型: `chat` / `embedding` / `rerank` |
| `is_active` | boolean | 是否激活 (每种类型只能有一个激活) |
| `user_id` | UUID | 用户 ID |

## 7. AI 服务核心代码

### 文件: `backend/app/services/ai_service.py`

#### 7.1 从配置创建服务

```python
# 第 390-415 行
def create_ai_service_from_config(config: dict) -> AIService:
    """
    Create AIService from API config dict.
    Handles decryption of api_key and api_base if encrypted.
    """
    api_key = config["api_key"]
    api_base = config["api_base"]

    # 尝试解密，如果失败则使用原值
    try:
        api_key = decrypt(api_key)
    except Exception:
        pass

    try:
        api_base = decrypt(api_base)
    except Exception:
        pass

    return AIService(
        api_key=api_key,
        api_base=api_base,
        model=config["model"],
    )
```

#### 7.2 系统提示词

```python
# 第 58-73 行
ANALYSIS_PROMPT = """你是一个专业的GitHub仓库分析助手。请分析以下仓库的README内容，并提取关键信息。

请以JSON格式返回以下信息：
1. summary: 用中文简洁描述这个仓库的主要功能和用途（50-100字）
2. tags: 提取3-5个技术标签（如：React, TypeScript, CLI, API等）
3. platforms: 识别支持的平台（可选值：Windows, macOS, Linux, iOS, Android, Web, CLI, Docker）

只返回JSON，不要有其他内容。格式示例：
{
  "summary": "这是一个...",
  "tags": ["React", "TypeScript", "UI"],
  "platforms": ["Web", "macOS", "Windows"]
}

如果无法确定某个字段，使用空数组或空字符串。"""
```

#### 7.3 HTTP 请求代码

```python
# 第 130-194 行
async def analyze_repository(
    self,
    readme_content: str,
    repo_name: str,
    description: Optional[str] = None
) -> dict:
    # 构建用户消息
    user_message = f"仓库名称: {repo_name}\n"
    if description:
        user_message += f"仓库描述: {description}\n"
    user_message += f"\nREADME内容:\n{readme_content[:8000]}"  # 限制 8000 字符

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            f"{self.api_base}/chat/completions",  # ← 实际 API 调用
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": ANALYSIS_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                "temperature": 0.3,
                "max_tokens": 2048,
            },
        )

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return self._parse_response(content)
```

#### 7.4 批量分析与降级策略

```python
# 第 324-387 行
async def analyze_repositories_batch(
    self,
    repos: list[dict],
    concurrency: int = 5,      # 最大并发数
    use_fallback: bool = True, # AI 失败时使用降级
    on_progress: Optional[Callable] = None,
) -> dict[str, dict]:
    semaphore = asyncio.Semaphore(concurrency)

    async def analyze_one(repo: dict):
        async with semaphore:
            if repo.get("readme_content"):
                result = await self.analyze_repository(...)
                results[repo_id] = {"success": True, "data": result}
            elif use_fallback:
                # 无 README 时使用降级分析
                result = self.fallback_analysis(repo)
                results[repo_id] = {"success": True, "data": result, "fallback": True}
```

**降级分析逻辑** (`fallback_analysis`):
- 根据编程语言推断平台 (如 Swift → iOS/macOS)
- 根据关键词推断平台 (如 "docker" → Docker)
- 返回空 summary 和 tags，仅填充 platforms

## 数据流总结

```
用户点击同步
    │
    ▼
前端 syncRepositories()
    │
    ▼ POST /api/repositories/sync
后端 sync_repositories()
    │
    ├─► GitHub API: 获取 starred repos
    │
    ├─► GitHub API: 获取 README 内容
    │
    └─► analyze_repositories_needing_analysis()
            │
            ├─► ApiConfigService.get_active_config("chat")
            │       │
            │       └─► SELECT * FROM api_configs WHERE type='chat' AND is_active=true
            │
            └─► AIService.analyze_repositories_batch()
                    │
                    └─► POST {api_base}/chat/completions
                            │
                            └─► 返回 JSON: {summary, tags, platforms}
```

## 关键配置要求

1. **GitHub Token**: 在设置页面配置，用于获取 starred repos
2. **Chat API 配置**: 在 API 配置页面添加，必须设置为 `is_active=true`
   - `api_key`: OpenAI 兼容的 API Key
   - `api_base`: API 基础 URL (如 `https://api.openai.com/v1`)
   - `model`: 模型名称 (如 `gpt-4`, `gpt-3.5-turbo`)

## 相关文件索引

| 层级 | 文件路径 | 关键函数/类 |
|------|----------|-------------|
| 前端 UI | `frontend/components/repository/repository-page.tsx` | `handleSync()` |
| 前端 Store | `frontend/lib/store/repositories.slice.ts` | `syncRepositories()` |
| 前端 API | `frontend/lib/api/repositories.ts` | `syncWithProgress()` |
| 后端路由 | `backend/app/api/routers/repositories.py` | `sync_repositories()` |
| 分析协调 | `backend/app/services/repository_analyzer.py` | `analyze_repositories_needing_analysis()` |
| 配置服务 | `backend/app/services/db/api_configs.py` | `ApiConfigService.get_active_config()` |
| AI 服务 | `backend/app/services/ai_service.py` | `AIService`, `create_ai_service_from_config()` |


