# 迁移清理问题清单

> 记录 Next.js → FastAPI 迁移后，frontend 文件夹中仍存在的后端代码/非纯前端问题
>
> **目标**：使 frontend 成为纯前端项目，所有后端逻辑在 FastAPI 中处理

---

## 迁移状态总览

| 模块 | 状态 | 位置 |
|------|------|------|
| Auth API | ✅ 已迁移 | `backend/app/api/routers/auth.py` |
| Feeds CRUD | ✅ 已迁移 | `backend/app/api/routers/feeds.py` |
| Folders CRUD | ✅ 已迁移 | `backend/app/api/routers/folders.py` |
| Articles CRUD | ✅ 已迁移 | `backend/app/api/routers/articles.py` |
| Settings CRUD | ✅ 已迁移 | `backend/app/api/routers/settings.py` |
| RSS 解析 | ✅ 已迁移 | `backend/app/api/routers/rss.py` |
| Realtime WebSocket | ✅ 已迁移 | `backend/app/api/routers/websocket.py` |
| Store Slices | ✅ 已迁移 | 全部使用 `lib/api/*.ts` |
| RSS 定时刷新 | ⏸️ 暂不实现 | 用户决定暂不迁移 |

---

## 🚨 需要修复的问题

### Issue 1: Sidebar 直接调用 Supabase Auth

**优先级**: 🔴 高

**问题描述**:
Sidebar 组件中的 logout 功能直接调用 `supabase.auth.signOut()`，绕过了 FastAPI 后端的认证流程。这会导致：
- HttpOnly Cookie 未被清除（后端负责清除）
- 认证状态不一致

**涉及文件**:
```
frontend/components/sidebar/collapsed-view.tsx:27
frontend/components/sidebar/expanded-view.tsx:65
```

**当前代码**:
```typescript
// collapsed-view.tsx
import { supabase } from "@/lib/supabase/client"

const handleLogout = async (e: React.MouseEvent) => {
  e.stopPropagation()
  await supabase.auth.signOut()  // ❌ 直接调用 Supabase
  router.push('/login')
}
```

**修复方案**:
```typescript
// collapsed-view.tsx
import { useAuth } from "@/lib/context/auth-context"

export function CollapsedView({ ... }) {
  const { logout } = useAuth()

  const handleLogout = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await logout()  // ✅ 通过 AuthContext，会调用 FastAPI
  }
}
```

**修复步骤**:
1. 在 `collapsed-view.tsx` 中导入 `useAuth`
2. 替换 `supabase.auth.signOut()` 为 `logout()`
3. 移除 `supabase` 导入
4. 对 `expanded-view.tsx` 执行相同操作

---

### Issue 2: RSS Parser 使用 Supabase 获取 Token

**优先级**: 🟡 中

**问题描述**:
`lib/rss-parser.ts` 通过 Supabase SDK 获取 access token 来调用 FastAPI 后端。这造成了不必要的 Supabase 依赖。

**涉及文件**:
```
frontend/lib/rss-parser.ts:14-20
```

**当前代码**:
```typescript
import { supabase } from "./supabase/client"

async function getAccessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) {
    throw new Error("Not authenticated")
  }
  return session.access_token
}
```

**修复方案 A - 使用 AuthContext** (推荐):
```typescript
// 需要将 parseRSSFeed 改为 React Hook 或接受 token 参数
export async function parseRSSFeed(
  url: string,
  feedId: string,
  accessToken: string  // 从调用处传入
): Promise<...>
```

**修复方案 B - 使用 Cookie 认证**:
由于 FastAPI 已支持 cookie 认证，可以直接发送请求（浏览器自动携带 cookie）：
```typescript
export async function parseRSSFeed(url: string, feedId: string) {
  const response = await fetch("/api/backend/rss/parse", {
    method: "POST",
    credentials: "include",  // ✅ 自动携带 HttpOnly cookie
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, feedId }),
  })
  // ...
}
```

**注意**: 需要确认 FastAPI RSS router 支持 cookie 认证（当前使用 `verify_jwt` 依赖，需检查是否支持 cookie）

---

### Issue 3: BullMQ 调度器代码仍在前端

**优先级**: 🟡 中

**问题描述**:
BullMQ 相关代码是服务端代码（依赖 Redis），不应存在于纯前端项目中。虽然用户决定"暂不实现 RSS 定时刷新"，但当前代码仍在被调用。

**涉及文件**:
```
frontend/app/api/scheduler/schedule/route.ts   # Next.js API Route
frontend/app/api/scheduler/cancel/route.ts     # Next.js API Route
frontend/lib/scheduler-client.ts               # 客户端调用
frontend/lib/scheduler.ts                      # 调度器逻辑
frontend/lib/queue/index.ts                    # Queue 配置
frontend/lib/queue/worker.ts                   # BullMQ Worker
frontend/lib/queue/rss-scheduler.ts            # RSS 调度逻辑
```

**当前调用点**:
```typescript
// frontend/lib/store/feeds.slice.ts:69
scheduleFeedRefresh(newFeed).catch((err) => {
  console.error("Failed to schedule feed refresh:", err)
})

// frontend/lib/store/feeds.slice.ts:98
await cancelFeedRefresh(feedId)
```

**修复方案 A - 禁用调用** (最小改动):
```typescript
// frontend/lib/scheduler-client.ts
export async function scheduleFeedRefresh(feed: Feed, forceImmediate = false): Promise<void> {
  // 暂时禁用 - RSS 定时刷新功能待实现
  console.debug("[Scheduler] Feed refresh scheduling is disabled")
  return
}

export async function cancelFeedRefresh(feedId: string): Promise<void> {
  // 暂时禁用
  return
}
```

**修复方案 B - 完全移除** (清理工作):
1. 删除 `frontend/app/api/scheduler/` 目录
2. 删除 `frontend/lib/queue/` 目录
3. 删除 `frontend/lib/scheduler.ts`
4. 修改 `frontend/lib/scheduler-client.ts` 为空实现
5. 从 `feeds.slice.ts` 中移除调用

**修复方案 C - 迁移到 FastAPI** (未来实现):
如果需要 RSS 定时刷新功能，应在 FastAPI 中实现：
- 使用 Celery + Redis 或 APScheduler
- 前端只调用 FastAPI 端点来启动/取消调度

---

### Issue 4: 未使用的 Next.js RSS API Routes

**优先级**: 🟢 低

**问题描述**:
这些 API Routes 已被 FastAPI 版本替代，但仍保留在代码中。

**涉及文件**:
```
frontend/app/api/rss/parse/route.ts
frontend/app/api/rss/validate/route.ts
```

**当前状态**:
- 实际调用：`/api/backend/rss/parse` → FastAPI (via rewrite)
- 这些文件未被使用

**修复方案**:
直接删除这两个文件（作为清理工作的一部分）

---

## 📦 按计划保留的备份代码

以下代码按 `MIGRATION_TODO.md` 的决定保留作为备份，**无需修改**：

| 目录/文件 | 说明 |
|-----------|------|
| `frontend/lib/db/*.ts` | 旧的数据库操作代码 |
| `frontend/lib/supabase/*.ts` | Supabase 客户端实现 |
| `frontend/lib/realtime.ts` | 旧的 Supabase Realtime 实现 |

---

## 修复优先级总结

| 优先级 | Issue | 工作量 | 风险 |
|--------|-------|--------|------|
| 🔴 高 | Issue 1: Sidebar logout | 小 | 低 |
| 🟡 中 | Issue 2: RSS Parser token | 中 | 中 |
| 🟡 中 | Issue 3: BullMQ 调度器 | 小(禁用) / 大(移除) | 低 |
| 🟢 低 | Issue 4: 未使用的 RSS Routes | 小 | 无 |

---

## 建议的修复顺序

1. **Issue 1** - 修复 Sidebar logout（5分钟）
2. **Issue 3 方案A** - 禁用 scheduler 调用（5分钟）
3. **Issue 2 方案B** - 改用 cookie 认证（需先验证 FastAPI 支持）
4. **Issue 4** - 删除未使用的 RSS routes（清理阶段）

---

## 验证清单

修复完成后，确认以下条件：

- [ ] `frontend/` 中无直接 Supabase 数据库操作
- [ ] `frontend/` 中无 `supabase.auth.*` 调用（除 `auth-context.tsx` 中的 session 同步）
- [ ] `frontend/app/api/` 中无实际被使用的后端逻辑
- [ ] 所有数据操作通过 `lib/api/*.ts` → FastAPI
- [ ] Logout 功能通过 `useAuth().logout()` 统一处理

---

*创建时间: 2024-12-09*
*基于: MIGRATION_TODO.md 迁移完成后的代码审查*
