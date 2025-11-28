# 前端集成指南

## 概述

本文档详细说明如何将 Next.js 前端与新的 FastAPI 后端集成。

**参考项目**: `reference_repository/nextjs-starter-template` 的前端集成模式

> **📝 Chat 设计**: Chat 功能采用无状态设计，不存储聊天记录。聊天历史由前端 `useChat` hook 管理，刷新页面后历史丢失。

**核心集成点**:
1. **Next.js Rewrites** - 前后端通信（核心）
2. **AuthContext** - 认证状态和 Token 管理
3. **fetchWithAuth** - 带认证的请求工具
4. **useChat hook** - Vercel AI SDK 流式聊天（无状态）

> **📖 前置依赖**: 请先完成 [11-fastapi-backend-setup.md](./11-fastapi-backend-setup.md) 和 [13-chat-implementation.md](./13-chat-implementation.md)

---

## 参考项目架构

参考 `nextjs-starter-template/frontend` 的前端集成模式：

```
frontend/src/
├── context/
│   └── AuthContext.tsx        # 认证状态 + getToken()
├── utils/
│   └── fetchWithAuth.ts       # 带认证的 fetch 封装
├── components/chat/
│   └── Section.tsx            # Chat 主组件 (useChat hook)
└── middleware.ts              # Supabase session 刷新
```

**核心特点**:
- **AuthContext**: 提供 `getToken()` 方法获取 JWT
- **fetchWithAuth**: 自动添加 Authorization header
- **useChat hook**: 连接 FastAPI 流式端点
- **Middleware**: 自动刷新 Supabase session

---

## 架构说明

本项目使用 **Next.js Rewrites** 实现前后端通信：

```
Browser → Next.js (:3000) --rewrites--> FastAPI (:8000)
```

**优势**：
- **无 CORS 问题**：浏览器视角下所有请求都发往 `:3000`
- **流式响应稳定**：SSE/WebSocket 自动转发
- **配置集中**：一处 `next.config.js` 管理所有规则
- **代码简洁**：无需为每个 API 创建代理文件

---

## 第零步：配置 Next.js Rewrites

在 `next.config.js` 中添加 rewrites 配置，这是整个集成的核心：

```javascript
// next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ... 其他现有配置 ...

  async rewrites() {
    // 开发环境使用本地 FastAPI，生产环境使用环境变量
    const fastApiUrl = process.env.NODE_ENV === "development"
      ? "http://127.0.0.1:8000"
      : process.env.FASTAPI_URL || "http://127.0.0.1:8000"

    return [
      {
        // 所有 /api/backend/* 请求转发到 FastAPI
        source: "/api/backend/:path*",
        destination: `${fastApiUrl}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
```

### 路由映射规则

| 前端请求 | 转发到 FastAPI |
|---------|---------------|
| `/api/backend/rss/schedule` | `http://127.0.0.1:8000/api/rss/schedule` |
| `/api/backend/chat/sessions` | `http://127.0.0.1:8000/api/chat/sessions` |
| `/api/backend/health` | `http://127.0.0.1:8000/api/health` |

> **⚠️ 重要**：修改 `next.config.js` 后需要重启 Next.js 开发服务器！

---

## 第一步：AuthContext 认证管理

参考 `nextjs-starter-template/frontend/src/context/AuthContext.tsx`：

```typescript
// lib/context/auth-context.tsx

"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode
} from "react"
import { User, Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase/client"

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  getToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  getToken: async () => null
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 获取初始会话
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // 监听认证状态变化
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  /**
   * 获取当前 JWT token
   *
   * 参考: nextjs-starter-template 的 getToken() 实现
   * 用于 API 请求的 Authorization header
   */
  const getToken = useCallback(async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }, [])

  return (
    <AuthContext.Provider value={{ user, session, loading, getToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
```

### 在 Layout 中使用 AuthProvider

```typescript
// app/layout.tsx 或 app/(reader)/layout.tsx

import { AuthProvider } from "@/lib/context/auth-context"

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
```

---

## 第二步：fetchWithAuth 工具函数

参考 `nextjs-starter-template/frontend/src/utils/fetchWithAuth.ts`：

```typescript
// lib/utils/fetch-with-auth.ts

import { supabase } from "@/lib/supabase/client"

/**
 * 带认证的 fetch 封装
 *
 * 参考: nextjs-starter-template/frontend/src/utils/fetchWithAuth.ts
 *
 * 特点:
 * - 自动添加 Authorization header
 * - 通过 Next.js rewrites 访问 FastAPI
 * - 统一错误处理
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()

  const headers = new Headers(options.headers)

  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`)
  }

  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json")
  }

  return fetch(url, {
    ...options,
    headers
  })
}

/**
 * 带认证的 JSON 请求
 */
export async function fetchJsonWithAuth<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetchWithAuth(url, options)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }))
    throw new Error(error.detail || error.error || `HTTP ${response.status}`)
  }

  return response.json()
}
```

---

## 第三步：后端 API 客户端

```typescript
// lib/api/backend.ts

/**
 * FastAPI 后端 API 客户端
 *
 * 参考: nextjs-starter-template 的前端 API 调用模式
 *
 * 所有请求通过 Next.js Rewrites 转发:
 * /api/backend/* → FastAPI :8000/api/*
 */

import { fetchWithAuth, fetchJsonWithAuth } from "@/lib/utils/fetch-with-auth"

// ============================================
// RSS 调度 API
// ============================================

export interface ScheduleFeedParams {
  id: string
  url: string
  title: string
  refreshInterval?: number
  lastFetched?: Date | null
}

export interface ScheduleFeedResponse {
  success: boolean
  delay_seconds: number
  priority: string
  task_id: string
}

/**
 * 调度 Feed 刷新
 *
 * 替代原有的 BullMQ 调度
 */
export async function scheduleFeed(
  feed: ScheduleFeedParams,
  forceImmediate: boolean = false
): Promise<ScheduleFeedResponse> {
  return fetchJsonWithAuth("/api/backend/rss/schedule", {
    method: "POST",
    body: JSON.stringify({
      feed_id: feed.id,
      feed_url: feed.url,
      feed_title: feed.title,
      refresh_interval: feed.refreshInterval || 60,
      last_fetched: feed.lastFetched?.toISOString() || null,
      force_immediate: forceImmediate,
    }),
  })
}

/**
 * 取消 Feed 调度
 */
export async function cancelFeedSchedule(feedId: string): Promise<{ success: boolean }> {
  return fetchJsonWithAuth("/api/backend/rss/cancel", {
    method: "POST",
    body: JSON.stringify({ feed_id: feedId }),
  })
}

/**
 * 强制立即刷新 Feed
 */
export async function forceRefreshFeed(feedId: string): Promise<{
  success: boolean
  task_id: string
}> {
  return fetchJsonWithAuth("/api/backend/rss/force-refresh", {
    method: "POST",
    body: JSON.stringify({ feed_id: feedId }),
  })
}

/**
 * 初始化 RSS 调度器
 */
export async function initRSSScheduler(): Promise<{
  success: boolean
  scheduled_count: number
}> {
  return fetchJsonWithAuth("/api/backend/rss/init", {
    method: "POST",
  })
}

// ============================================
// Chat API（无状态设计）
// ============================================

/**
 * Chat API 端点（用于 useChat hook）
 *
 * 无状态设计：不存储聊天记录，历史由前端管理
 */
export const CHAT_API_URL = "/api/backend/chat/completions"

// ============================================
// 健康检查
// ============================================

/**
 * 检查后端服务是否可用
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch("/api/backend/health")
    return response.ok
  } catch {
    return false
  }
}
```

---

## 第四步：Chat 页面集成（无状态设计）

Chat 采用无状态设计，不存储聊天记录，代码相比有状态版本大幅简化：

```typescript
// app/(reader)/chat/page.tsx

"use client"

import { useEffect, useState, useRef } from "react"
import { useChat } from "ai/react"
import { useAuth } from "@/lib/context/auth-context"
import { CHAT_API_URL } from "@/lib/api/backend"

import { ChatMessages } from "@/components/chat/chat-messages"
import { ChatInput } from "@/components/chat/chat-input"

/**
 * Chat 页面（无状态设计）
 *
 * 特点:
 * - 不存储聊天记录到数据库
 * - 聊天历史由 useChat hook 内部管理
 * - 刷新页面后历史消息丢失
 * - 无需会话侧边栏
 */
export default function ChatPage() {
  const { getToken, user, loading: authLoading } = useAuth()
  const [token, setToken] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 获取 JWT token
  useEffect(() => {
    if (!authLoading && user) {
      getToken().then(setToken)
    }
  }, [authLoading, user, getToken])

  // useChat hook (Vercel AI SDK)
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    setMessages,
    error
  } = useChat({
    // 通过 rewrites 转发到 FastAPI
    api: CHAT_API_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    // 匹配后端的 0:"{chunk}"\n 格式
    streamProtocol: "data",
  })

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // 清空聊天
  const handleClearChat = () => {
    setMessages([])
  }

  // 认证检查
  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Please sign in to use chat.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-lg font-semibold">Chat</h1>
        <button
          onClick={handleClearChat}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-2">
          Error: {error.message}
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <ChatMessages messages={messages} isLoading={isLoading} />
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t p-4">
        <ChatInput
          input={input}
          isLoading={isLoading}
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  )
}
```

> **📝 Note**: 无状态设计不需要 `ChatSidebar` 组件，也不需要 `uuid` 依赖。

---

## 第五步：更新 Store Actions

### 修改 feeds.slice.ts

```typescript
// lib/store/feeds.slice.ts

import {
  scheduleFeed,
  cancelFeedSchedule,
  forceRefreshFeed
} from "@/lib/api/backend"

// ... 其他导入 ...

export const createFeedsSlice: StateCreator<
  RSSReaderState,
  [],
  [],
  FeedsSlice
> = (set, get) => ({
  feeds: [],

  // 添加 Feed
  addFeed: async (feed) => {
    // ... 现有的添加逻辑 ...

    // 替换原有的 BullMQ 调度
    try {
      await scheduleFeed({
        id: feed.id,
        url: feed.url,
        title: feed.title,
        refreshInterval: feed.refreshInterval,
        lastFetched: feed.lastFetched,
      })
    } catch (error) {
      console.error("Failed to schedule feed:", error)
    }
  },

  // 更新 Feed
  updateFeed: async (feedId, updates) => {
    // ... 现有的更新逻辑 ...

    // 如果更新了刷新间隔或 URL，重新调度
    if (updates.refreshInterval || updates.url) {
      const feed = get().feeds.find(f => f.id === feedId)
      if (feed) {
        try {
          await scheduleFeed({
            id: feed.id,
            url: updates.url || feed.url,
            title: updates.title || feed.title,
            refreshInterval: updates.refreshInterval || feed.refreshInterval,
            lastFetched: feed.lastFetched,
          })
        } catch (error) {
          console.error("Failed to reschedule feed:", error)
        }
      }
    }
  },

  // 删除 Feed
  deleteFeed: async (feedId) => {
    // 取消调度
    try {
      await cancelFeedSchedule(feedId)
    } catch (error) {
      console.error("Failed to cancel feed schedule:", error)
    }

    // ... 现有的删除逻辑 ...
  },

  // 刷新 Feed
  refreshFeed: async (feedId) => {
    const feed = get().feeds.find(f => f.id === feedId)
    if (!feed) return

    try {
      await forceRefreshFeed(feedId)
    } catch (error) {
      console.error("Failed to refresh feed:", error)
    }
  },

  // ... 其他方法 ...
})
```

---

## 第六步：更新 Layout 初始化

```typescript
// app/(reader)/layout.tsx

"use client"

import { useEffect, useState } from "react"
import { useStore } from "@/lib/store"
import { initRSSScheduler, checkBackendHealth } from "@/lib/api/backend"
import { useAuth } from "@/lib/context/auth-context"
import { Sidebar } from "@/components/sidebar"
import { DatabaseSetup } from "@/components/database-setup"

export default function ReaderLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isDatabaseReady, loadFromSupabase } = useStore()
  const { user, loading: authLoading } = useAuth()
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    const initialize = async () => {
      if (!isDatabaseReady || authLoading || !user) return

      try {
        // 加载数据
        await loadFromSupabase()

        // 初始化 RSS 调度器 (替换原有的 BullMQ 初始化)
        const backendHealthy = await checkBackendHealth()
        if (backendHealthy) {
          await initRSSScheduler()
          console.log("RSS scheduler initialized via FastAPI")
        } else {
          console.warn("FastAPI backend not available, RSS scheduling disabled")
        }

        setIsInitialized(true)
      } catch (error) {
        console.error("Initialization failed:", error)
        setIsInitialized(true) // 继续加载 UI
      }
    }

    initialize()
  }, [isDatabaseReady, authLoading, user, loadFromSupabase])

  if (!isDatabaseReady) {
    return <DatabaseSetup />
  }

  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
```

---

## 第七步：环境变量配置

使用 Next.js Rewrites 后，**无需配置 `NEXT_PUBLIC_BACKEND_URL`**。

### .env.local（开发环境）

```bash
# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# 无需添加 NEXT_PUBLIC_BACKEND_URL
# rewrites 默认转发到 http://127.0.0.1:8000
```

### .env.production（生产环境）

```bash
# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# FastAPI 后端 URL（仅服务端使用，非 NEXT_PUBLIC_）
FASTAPI_URL=https://your-fastapi-backend.com
```

---

## 第八步：移除 BullMQ 依赖

### 删除文件

```bash
# 删除 BullMQ 相关文件
rm -rf lib/queue/
rm lib/scheduler-client.ts
rm -rf app/api/scheduler/
```

### 更新 package.json

```json
{
  "scripts": {
    "dev": "next dev",
    "dev:all": "concurrently -n next,fastapi,celery -c blue,yellow,green \"pnpm dev\" \"pnpm backend:dev\" \"pnpm celery:dev\"",
    "build": "next build",
    "start": "next start",

    "backend:dev": "cd backend && poetry run uvicorn app.main:app --reload --port 8000",
    "celery:dev": "cd backend && poetry run celery -A app.core.celery_app worker --loglevel=info",
    "celery:flower": "cd backend && poetry run celery -A app.core.celery_app flower --port=5555"
  }
}
```

### 运行清理

```bash
# 移除 BullMQ 依赖
pnpm remove bullmq ioredis

# 安装新依赖（无状态 Chat 不需要 uuid）
pnpm add ai

# 重新安装
pnpm install
```

---

## 第九步：Docker Compose 集成

参考 `nextjs-starter-template/docker-compose.yml`：

```yaml
# docker-compose.yml

version: "3.8"

services:
  frontend:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
      - FASTAPI_URL=http://backend:8000
    depends_on:
      - backend

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis

  celery:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: poetry run celery -A app.core.celery_app worker --loglevel=info
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis
      - backend

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

### Backend Dockerfile

```dockerfile
# backend/Dockerfile

FROM python:3.11-slim

WORKDIR /app

# 安装 Poetry
RUN pip install poetry

# 复制依赖文件
COPY pyproject.toml poetry.lock ./

# 安装依赖
RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi

# 复制应用代码
COPY . .

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 文件变更总结

### 新增文件

| 文件 | 用途 |
|------|------|
| `lib/context/auth-context.tsx` | AuthContext 认证管理 |
| `lib/utils/fetch-with-auth.ts` | fetchWithAuth 工具函数 |
| `lib/api/backend.ts` | FastAPI 后端 API 客户端 |
| `app/(reader)/chat/page.tsx` | Chat 页面（无状态） |
| `components/chat/chat-messages.tsx` | 消息列表组件 |
| `components/chat/chat-input.tsx` | 输入框组件 |
| `components/chat/chat-message.tsx` | 单条消息组件 |
| `docker-compose.yml` | Docker 编排 |
| `backend/Dockerfile` | 后端 Docker 镜像 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `next.config.js` | 添加 rewrites 规则 |
| `app/layout.tsx` | 添加 AuthProvider |
| `app/(reader)/layout.tsx` | 替换初始化逻辑 |
| `lib/store/feeds.slice.ts` | 替换 BullMQ 调用 |
| `components/sidebar/index.tsx` | 添加 Chat 入口 |
| `package.json` | 更新脚本和依赖 |

### 删除文件

| 文件/目录 | 原用途 |
|-----------|--------|
| `lib/queue/` | BullMQ 队列实现 |
| `lib/scheduler-client.ts` | BullMQ 客户端 |
| `app/api/scheduler/` | 调度器 API 路由 |

---

## 测试验证

### 1. 启动服务

```bash
# 方式一：分别启动
# 终端 1: Next.js
pnpm dev

# 终端 2: FastAPI
cd backend && poetry run uvicorn app.main:app --reload --port 8000

# 终端 3: Celery Worker
cd backend && poetry run celery -A app.core.celery_app worker --loglevel=info

# 方式二：一键启动
pnpm dev:all

# 方式三：Docker Compose
docker compose up --build
```

### 2. 验证 RSS 调度

1. 打开应用
2. 添加一个新 Feed
3. 检查 Celery worker 日志是否显示任务调度
4. 等待任务执行，检查文章是否更新

### 3. 验证 Chat 功能

1. 导航到 `/chat`
2. 发送一条消息
3. 验证流式响应正常显示
4. 点击 "Clear" 按钮验证聊天清空功能
5. 刷新页面确认历史消息已清空（无状态设计）

---

## 故障排除

### Rewrites 不生效

**症状**: 请求 `/api/backend/*` 返回 404

**检查**:
1. `next.config.js` 中是否正确配置了 `rewrites()`
2. **重启 Next.js 开发服务器**（修改 `next.config.js` 后必须重启）
3. FastAPI 服务是否运行：`curl http://localhost:8000/health`

### 认证失败

**检查**:
1. AuthProvider 是否正确包装应用
2. `getToken()` 是否返回有效 token
3. 后端 `get_current_user_id` 依赖是否正确验证

### 流式响应中断

**检查**:
1. 后端是否设置 `x-vercel-ai-data-stream: v1` header
2. `useChat` 的 `streamProtocol` 是否为 `"data"`
3. 浏览器 Network 面板检查响应

### 后端不可用

```bash
# 检查 FastAPI
curl http://localhost:8000/health

# 检查 rewrites 转发
curl http://localhost:3000/api/backend/health
```

> **💡 提示**: 使用 Next.js Rewrites 后，**无需担心 CORS 问题**。

---

## 下一步

完成前端集成后，整个迁移就完成了。后续可以考虑：

1. **性能优化** - 添加请求缓存、错误重试
2. **监控** - Flower 监控 Celery 任务
3. **RAG 扩展** - 集成 pgvector 语义搜索
4. **测试** - 添加 E2E 测试验证完整流程
