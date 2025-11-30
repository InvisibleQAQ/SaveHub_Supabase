# 前端集成与代理配置

## 概述

本文档说明如何配置 Next.js 前端以使用 FastAPI 后端的 RSS 功能，包括代理配置、API 调用更新和迁移测试。

## 代理配置

### 现有配置

`next.config.mjs` 已配置代理规则：

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },

  // FastAPI Backend Rewrites
  async rewrites() {
    const fastApiUrl = process.env.NODE_ENV === "development"
      ? "http://127.0.0.1:8000"
      : process.env.FASTAPI_URL || "http://127.0.0.1:8000"

    return [
      {
        source: "/api/backend/:path*",
        destination: `${fastApiUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
```

### 代理路由映射

| 前端调用 | 代理后 |
|----------|--------|
| `POST /api/backend/rss/validate` | `POST http://127.0.0.1:8000/api/rss/validate` |
| `POST /api/backend/rss/parse` | `POST http://127.0.0.1:8000/api/rss/parse` |
| `POST /api/backend/scheduler/schedule` | `POST http://127.0.0.1:8000/api/scheduler/schedule` |
| `POST /api/backend/scheduler/cancel` | `POST http://127.0.0.1:8000/api/scheduler/cancel` |

### 生产环境配置

在 `.env.production` 或环境变量中设置：

```env
FASTAPI_URL=https://your-fastapi-domain.com
```

## 前端代码更新

### RSS 解析器更新

**文件**: `lib/rss-parser.ts`

```typescript
// 原代码
const response = await fetch("/api/rss/parse", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url, feedId }),
})

// 新代码（使用 FastAPI 后端）
const response = await fetch("/api/backend/rss/parse", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,  // 添加 JWT
  },
  body: JSON.stringify({ url, feedId }),
})
```

完整更新后的文件：

```typescript
/**
 * RSS 解析器客户端
 *
 * 调用 FastAPI 后端的 RSS 端点。
 */

import { supabase } from "@/lib/supabase/client"

interface ParsedFeed {
  title: string
  description: string
  link: string
  image?: string
}

interface ParsedArticle {
  id: string
  feedId: string
  title: string
  content: string
  summary: string
  url: string
  author?: string
  publishedAt: string
  isRead: boolean
  isStarred: boolean
  thumbnail?: string
}

interface ParseResponse {
  feed: ParsedFeed
  articles: ParsedArticle[]
}

/**
 * 获取当前用户的 JWT token
 */
async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error("User not authenticated")
  }
  return session.access_token
}

/**
 * 验证 RSS 订阅源 URL
 */
export async function validateRSSUrl(url: string): Promise<boolean> {
  try {
    const token = await getAuthToken()

    const response = await fetch("/api/backend/rss/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
    })

    if (!response.ok) {
      return false
    }

    const data = await response.json()
    return data.valid
  } catch (error) {
    console.error("RSS validation error:", error)
    return false
  }
}

/**
 * 解析 RSS 订阅源
 */
export async function parseRSSFeed(
  url: string,
  feedId: string
): Promise<ParseResponse> {
  const token = await getAuthToken()

  const response = await fetch("/api/backend/rss/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ url, feedId }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || "Failed to parse RSS feed")
  }

  return response.json()
}

/**
 * 生成常见的 RSS 订阅源 URL 模式
 */
export function discoverRSSFeeds(url: string): string[] {
  const parsed = new URL(url)
  const baseUrl = `${parsed.protocol}//${parsed.host}`

  return [
    `${baseUrl}/feed`,
    `${baseUrl}/feed.xml`,
    `${baseUrl}/rss`,
    `${baseUrl}/rss.xml`,
    `${baseUrl}/atom.xml`,
    `${baseUrl}/feeds/all.atom.xml`,
    `${baseUrl}/index.xml`,
  ]
}
```

### 调度器客户端更新

**文件**: `lib/scheduler-client.ts`

```typescript
/**
 * 调度器客户端
 *
 * 调用 FastAPI 后端的调度器端点。
 */

import { supabase } from "@/lib/supabase/client"
import type { Feed } from "@/lib/types"

interface ScheduleResponse {
  success: boolean
  delaySeconds: number
  priority: string
}

/**
 * 获取当前用户的 JWT token
 */
async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error("User not authenticated")
  }
  return session.access_token
}

/**
 * 调度订阅源刷新
 */
export async function scheduleFeedRefresh(
  feed: Feed,
  forceImmediate: boolean = false
): Promise<ScheduleResponse> {
  const token = await getAuthToken()

  const response = await fetch("/api/backend/scheduler/schedule", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      feed: {
        id: feed.id,
        url: feed.url,
        title: feed.title,
        refreshInterval: feed.refreshInterval,
        lastFetched: feed.lastFetched?.toISOString() || null,
      },
      forceImmediate,
    }),
  })

  if (!response.ok) {
    throw new Error("Failed to schedule feed refresh")
  }

  return response.json()
}

/**
 * 取消订阅源刷新
 */
export async function cancelFeedRefresh(feedId: string): Promise<void> {
  const token = await getAuthToken()

  await fetch("/api/backend/scheduler/cancel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ feedId }),
  })
}

/**
 * 强制立即刷新订阅源
 */
export async function forceRefreshFeed(feed: Feed): Promise<ScheduleResponse> {
  return scheduleFeedRefresh(feed, true)
}
```

## 渐进式迁移策略

### 阶段 1：准备（不影响生产）

1. 部署 FastAPI 后端和 Celery worker
2. 确保所有新端点正常工作
3. 使用测试账户验证功能

### 阶段 2：功能开关

创建环境变量控制后端选择：

```typescript
// lib/config.ts
export const config = {
  useNewBackend: process.env.NEXT_PUBLIC_USE_FASTAPI_BACKEND === "true",
}
```

```typescript
// lib/rss-parser.ts
import { config } from "@/lib/config"

export async function parseRSSFeed(url: string, feedId: string) {
  const endpoint = config.useNewBackend
    ? "/api/backend/rss/parse"
    : "/api/rss/parse"

  // ... 其余代码
}
```

### 阶段 3：灰度发布

1. 设置 `NEXT_PUBLIC_USE_FASTAPI_BACKEND=true` 给部分用户
2. 监控错误率和性能
3. 逐步扩大范围

### 阶段 4：全量切换

1. 所有用户使用新后端
2. 保留旧端点作为回退
3. 监控一周后移除旧代码

## 测试检查清单

### 功能测试

- [ ] RSS 验证：有效 URL 返回 `{ valid: true }`
- [ ] RSS 验证：无效 URL 返回 `{ valid: false }`
- [ ] RSS 解析：返回正确的文章列表
- [ ] RSS 解析：正确提取缩略图
- [ ] 调度：立即刷新触发任务
- [ ] 调度：延迟刷新正确计算延迟
- [ ] 取消：成功取消已调度任务

### 认证测试

- [ ] 未认证请求返回 401
- [ ] 无效 token 返回 401
- [ ] 过期 token 返回 401
- [ ] 有效 token 正常访问

### 错误处理测试

- [ ] 网络错误正确处理
- [ ] 无效 RSS 返回友好错误
- [ ] 超时正确处理

### 性能测试

- [ ] 解析响应时间 < 5秒
- [ ] 并发请求正常处理
- [ ] 限速正确工作

## 调试技巧

### 查看代理请求

在浏览器开发者工具中：

1. 打开 Network 标签
2. 筛选 `/api/backend`
3. 检查请求/响应

### 查看 FastAPI 日志

```bash
# 开发模式带详细日志
poetry run uvicorn app.main:app --reload --log-level debug
```

### 查看 Celery 任务

```bash
# 查看活跃任务
poetry run celery -A celery_worker.celery_app inspect active

# 查看任务结果
poetry run celery -A celery_worker.celery_app result <task-id>
```

### 测试端点

```bash
# 获取 token
TOKEN=$(curl -X POST "https://your-project.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: your-anon-key" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  | jq -r '.access_token')

# 测试验证端点
curl -X POST "http://localhost:8000/api/rss/validate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/feed.xml"}'

# 测试解析端点
curl -X POST "http://localhost:8000/api/rss/parse" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/feed.xml","feedId":"550e8400-e29b-41d4-a716-446655440000"}'
```

## 常见问题

### 1. CORS 错误

确保 FastAPI 允许前端域名：

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://your-domain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 2. 代理不生效

检查 Next.js 开发服务器是否重启：

```bash
# 停止并重启
pnpm dev
```

### 3. JWT 验证失败

确保：
1. Supabase URL 和 Key 与前端一致
2. Token 未过期
3. Authorization header 格式正确：`Bearer <token>`

### 4. Celery 任务不执行

检查：
1. Redis 是否运行：`redis-cli ping`
2. Worker 是否启动：`celery -A celery_worker.celery_app inspect active`
3. 任务是否入队：`celery -A celery_worker.celery_app inspect reserved`

## 回滚方案

如果新后端出现问题：

1. **快速回滚**：将前端 API 调用改回 `/api/rss/*`
2. **环境变量回滚**：设置 `NEXT_PUBLIC_USE_FASTAPI_BACKEND=false`
3. **完全回滚**：恢复旧的 `lib/rss-parser.ts` 和 `lib/scheduler-client.ts`

原 Node.js 端点在过渡期保持可用，确保随时可以回滚。

## 完成后清理

迁移稳定后（建议观察 1-2 周）：

1. 删除旧的 Next.js API 路由：
   - `app/api/rss/validate/route.ts`
   - `app/api/rss/parse/route.ts`
   - `app/api/scheduler/schedule/route.ts`
   - `app/api/scheduler/cancel/route.ts`

2. 删除 BullMQ 相关代码：
   - `lib/queue/` 目录

3. 移除 Node.js 依赖：
   ```bash
   pnpm remove rss-parser bullmq ioredis
   ```

4. 更新文档和 README
