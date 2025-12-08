# Next.js → FastAPI 迁移 TODO

> 将 Next.js 前端的后端功能迁移到 FastAPI，使 Next.js 变成纯前端应用。
>
> **迁移策略**: 渐进式迁移，保留旧代码作为备份

---

## 用户需求汇总

| 需求              | 决定                                     |
| ----------------- | ---------------------------------------- |
| 后台任务调度      | 暂不实现 RSS 定时刷新                    |
| Realtime          | FastAPI WebSocket 转发 Supabase Realtime |
| API 密钥加密      | 暂不实现                                 |
| 认证              | 全部通过 FastAPI (HttpOnly Cookie)       |
| RSS 端点          | 使用 FastAPI 版本                        |
| Store             | 不允许直接数据库操作，全部通过 FastAPI   |
| Token 管理        | HttpOnly Cookie                          |
| 数据加载          | 按需加载 (Lazy)                          |
| 现有 API 路由     | 保留作为备份                             |
| Chat 功能         | 不包含                                   |
| lib/supabase 目录 | 保留作为备份                             |

---

## Phase 1: Authentication (优先级 1) ✅ 已完成

### FastAPI 后端

- [X] **1.1** 创建 `backend/app/schemas/auth.py`

  ```
  - LoginRequest (email, password)
  - RegisterRequest (email, password)
  - AuthResponse (user_id, email)
  - SessionResponse (authenticated, user_id, email)
  ```
- [X] **1.2** 创建 `backend/app/api/routers/auth.py`

  ```
  POST /api/auth/login     - 登录，设置 HttpOnly Cookie
  POST /api/auth/register  - 注册新用户
  POST /api/auth/logout    - 登出，清除 Cookie
  GET  /api/auth/session   - 检查当前 session
  POST /api/auth/refresh   - 刷新 token
  ```
- [X] **1.3** 修改 `backend/app/dependencies.py`

  - 添加 `verify_cookie_auth()` 函数
  - 添加 `verify_auth()` 函数（支持 cookie 和 header 两种认证方式）
  - 从 Cookie 读取 JWT token
  - 保留原有 `verify_jwt()` 用于向后兼容
- [X] **1.4** 修改 `backend/app/main.py`

  - 注册 auth router: `app.include_router(auth.router, prefix="/api")`

### Frontend 前端

- [X] **1.5** 创建 `frontend/lib/api/auth.ts`

  ```typescript
  login(email, password): Promise<AuthUser>
  register(email, password): Promise<AuthUser>
  logout(): Promise<void>
  getSession(): Promise<{ authenticated, user? }>
  refreshToken(): Promise<boolean>
  ```
- [X] **1.6** 创建 `frontend/lib/context/auth-context.tsx`

  - AuthProvider 组件
  - useAuth hook
  - 管理用户状态和认证方法
  - 自动 token 刷新（每 10 分钟）
- [X] **1.7** 修改 `frontend/app/login/page.tsx`

  - 替换 Supabase Auth UI 为自定义表单
  - 使用 AuthContext
  - 支持登录/注册切换
- [X] **1.8** 修改 `frontend/app/(reader)/layout.tsx`

  - 使用 `useAuth()` hook 替代 `supabase.auth.getSession()`
  - 移除 `supabase.auth.onAuthStateChange` 订阅
- [X] **1.9** 修改 `frontend/app/layout.tsx`

  - 添加 `AuthProvider` 包装整个应用

### Phase 1 测试

- [ ] **1.10** 测试登录/登出功能
- [ ] **1.11** 测试 session 持久化
- [ ] **1.12** 测试 token 刷新

---

## Phase 2: Data CRUD (优先级 2)

### Phase 2a: Feeds & Folders

#### FastAPI 后端

- [X] **2.1** 创建 `backend/app/api/routers/feeds.py`

  ```
  GET    /api/feeds           - 获取所有 feeds
  POST   /api/feeds           - 创建/批量 upsert feeds
  GET    /api/feeds/{id}      - 获取单个 feed
  PUT    /api/feeds/{id}      - 更新 feed
  DELETE /api/feeds/{id}      - 删除 feed + articles
  ```
- [X] **2.2** 创建 `backend/app/api/routers/folders.py`

  ```
  GET    /api/folders         - 获取所有 folders
  POST   /api/folders         - 创建/批量 upsert
  PUT    /api/folders/{id}    - 更新 folder
  DELETE /api/folders/{id}    - 删除 folder
  ```
- [X] **2.3** 注册 routers 到 main.py (feeds + folders)

#### Frontend 前端

- [X] **2.4** 创建 `frontend/lib/api/feeds.ts`
- [X] **2.5** 创建 `frontend/lib/api/folders.ts`
- [X] **2.6** 修改 `frontend/lib/store/feeds.slice.ts` - 使用 API
- [X] **2.7** 修改 `frontend/lib/store/folders.slice.ts` - 使用 API

#### Phase 2a 测试

- [X] **2.8** 测试 feeds CRUD
- [X] **2.9** 测试 folders CRUD

### Phase 2b: Articles & Settings

#### FastAPI 后端

- [X] **2.10** 创建 `backend/app/api/routers/articles.py`

  ```
  GET    /api/articles        - 获取 articles (filter: feed_id, limit)
  POST   /api/articles        - 批量创建 articles
  GET    /api/articles/{id}   - 获取单个 article
  PATCH  /api/articles/{id}   - 更新 (is_read, is_starred)
  DELETE /api/articles/old    - 清理旧 articles
  GET    /api/articles/stats  - 获取统计信息
  ```
- [X] **2.11** 创建 `backend/app/api/routers/settings.py`

  ```
  GET /api/settings  - 获取用户设置
  PUT /api/settings  - 更新设置
  ```
- [X] **2.12** 注册 routers 到 main.py

#### Frontend 前端

- [X] **2.13** 创建 `frontend/lib/api/articles.ts`
- [X] **2.14** 创建 `frontend/lib/api/settings.ts`
- [X] **2.15** 创建 `frontend/lib/api/index.ts` (统一导出)
- [ ] **2.16** 修改 `frontend/lib/store/articles.slice.ts` - 使用 API
- [ ] **2.17** 修改 `frontend/lib/store/settings.slice.ts` - 使用 API
- [ ] **2.18** 修改 `frontend/lib/store/database.slice.ts` - 使用 API 替代 dbManager

#### Phase 2b 测试

- [ ] **2.19** 测试 articles CRUD
- [ ] **2.20** 测试 settings CRUD
- [ ] **2.21** 测试整体数据加载流程

---

## Phase 3: Realtime WebSocket (优先级 3)

### FastAPI 后端

- [ ] **3.1** 创建 `backend/app/services/realtime.py`

  - ConnectionManager 类管理 WebSocket 连接
- [ ] **3.2** 创建 `backend/app/services/supabase_realtime.py`

  - SupabaseRealtimeForwarder 类订阅 postgres_changes
- [ ] **3.3** 创建 `backend/app/api/routers/websocket.py`

  ```
  WS /api/ws/realtime - WebSocket 端点
  - 认证通过 cookie
  - 转发 feeds/articles/folders 变更
  ```
- [ ] **3.4** 注册 WebSocket router 到 main.py

### Frontend 前端

- [ ] **3.5** 创建 `frontend/lib/realtime-ws.ts`

  - RealtimeWSManager 类
  - WebSocket 连接、重连、心跳
- [ ] **3.6** 修改 `frontend/hooks/use-realtime-sync.ts`

  - 使用 RealtimeWSManager 替代 supabase-js Realtime
- [ ] **3.7** 配置 WebSocket 代理 (或直接连接 FastAPI)

### Phase 3 测试

- [ ] **3.8** 测试多标签页同步
- [ ] **3.9** 测试断线重连

---

## 清理工作 (可选)

- [ ] **4.1** 移除未使用的 supabase-js 相关 imports
- [ ] **4.2** 更新 package.json 移除不再需要的依赖
- [ ] **4.3** 整理 deprecated 代码到 `_backup/` 目录

---

## 关键文件清单

### FastAPI 新建文件

```
backend/app/schemas/auth.py           - NEW
backend/app/api/routers/auth.py       - NEW
backend/app/api/routers/feeds.py      - NEW
backend/app/api/routers/articles.py   - NEW
backend/app/api/routers/folders.py    - NEW
backend/app/api/routers/settings.py   - NEW
backend/app/api/routers/websocket.py  - NEW
backend/app/services/realtime.py      - NEW
backend/app/services/supabase_realtime.py - NEW
```

### FastAPI 修改文件

```
backend/app/dependencies.py           - MODIFY (add cookie auth)
backend/app/main.py                   - MODIFY (register routers)
```

### Frontend 新建文件

```
frontend/lib/api/auth.ts              - NEW
frontend/lib/api/feeds.ts             - NEW
frontend/lib/api/articles.ts          - NEW
frontend/lib/api/folders.ts           - NEW
frontend/lib/api/settings.ts          - NEW
frontend/lib/api/index.ts             - NEW
frontend/lib/context/auth-context.tsx - NEW
frontend/lib/realtime-ws.ts           - NEW
```

### Frontend 修改文件

```
frontend/app/login/page.tsx           - MODIFY
frontend/app/(reader)/layout.tsx      - MODIFY
frontend/lib/store/database.slice.ts  - MODIFY
frontend/lib/store/feeds.slice.ts     - MODIFY
frontend/lib/store/articles.slice.ts  - MODIFY
frontend/lib/store/folders.slice.ts   - MODIFY
frontend/lib/store/settings.slice.ts  - MODIFY
frontend/hooks/use-realtime-sync.ts   - MODIFY
```

### 保留作为备份

```
frontend/app/api/                     - 保留
frontend/lib/supabase/                - 保留
frontend/lib/db/                      - 保留
```

---

## 数据流图

### Authentication

```
Browser → POST /api/auth/login → FastAPI → Supabase Auth
Browser ← Set-Cookie: sb_access_token ←
```

### CRUD

```
Browser → GET /api/feeds (Cookie) → FastAPI → FeedService → Supabase DB
Browser ← JSON: Feed[] ←
```

### Realtime

```
Browser ↔ WebSocket /ws/realtime ↔ FastAPI ↔ Supabase Realtime
```

---

## 进度跟踪

| Phase                       | 状态      | 完成项       | 总项         |
| --------------------------- | --------- | ------------ | ------------ |
| Phase 1: Auth               | ✅ 已完成 | 9            | 12           |
| Phase 2a: Feeds/Folders     | ✅ 已完成 | 9            | 9            |
| Phase 2b: Articles/Settings | 进行中    | 4            | 12           |
| Phase 3: Realtime           | 未开始    | 0            | 9            |
| **总计**              |           | **22** | **42** |

---

## 注意事项

1. **渐进式迁移**: 每个 Phase 完成后都应该可以独立测试
2. **保留备份**: 旧代码不删除，只是不再使用
3. **Cookie 安全**: 使用 HttpOnly, Secure, SameSite=Lax
4. **暂不实现**: RSS 定时刷新、API 密钥加密、Chat 功能

---

*最后更新: 2025-12-08*
