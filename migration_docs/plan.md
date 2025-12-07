Summary

    将 Next.js 前端的后端功能迁移到 FastAPI，使 Next.js 变成纯前端应用。

    User Requirements

| 需求              | 决定                                     |
| ----------------- | ---------------------------------------- |
| 后台任务调度      | 暂不实现 RSS 定时刷新                    |
|                   |                                          |
| Realtime          | FastAPI WebSocket 转发 Supabase Realtime |
| API 密钥加密      | 暂不实现                                 |
| 迁移策略          | 渐进式迁移                               |
| 认证              | 全部通过 FastAPI (HttpOnly Cookie)       |
| RSS 端点          | 使用 FastAPI 版本                        |
| Store             | 不允许直接数据库操作，全部通过 FastAPI   |
|                   |                                          |
| Token 管理        | HttpOnly Cookie                          |
| 数据加载          | 按需加载 (Lazy)                          |
| 现有 API 路由     | 保留作为备份                             |
| Chat 功能         | 不包含                                   |
| lib/supabase 目录 | 保留作为备份                             |
| 优先级            | 认证 > 数据 CRUD > Realtime              |

    ---
     Phase 1: Authentication (Priority 1)

    FastAPI Changes

    New File: backend/app/schemas/auth.py
     class LoginRequest(BaseModel):
         email: EmailStr
         password: str

    class RegisterRequest(BaseModel):
         email: EmailStr
         password: str

    class AuthResponse(BaseModel):
         user_id: str
         email: str

    class SessionResponse(BaseModel):
         authenticated: bool
         user_id: Optional[str] = None
         email: Optional[str] = None

    New File: backend/app/api/routers/auth.py

    | Method | Path               | Description       | Cookie

|                                   |                    |                     |                |
| --------------------------------- | ------------------ | ------------------- | -------------- |
| ------------------                |                    |                     |                |
| POST                              | /api/auth/login    | Email/password 登录 | Set            |
| sb_access_token, sb_refresh_token |                    |                     |                |
| POST                              | /api/auth/register | 注册新用户          | Set cookies    |
|                                   |                    |                     |                |
| POST                              | /api/auth/logout   | 登出                | Delete cookies |
|                                   |                    |                     |                |
| GET                               | /api/auth/session  | 检查当前 session    | Read cookies   |
|                                   |                    |                     |                |
| POST                              | /api/auth/refresh  | 刷新 token          | Update         |
| sb_access_token                   |                    |                     |                |

    Modify: backend/app/dependencies.py
     - 添加 verify_cookie_auth() 从 cookie 读取 JWT

    Modify: backend/app/main.py
     - 注册 auth router

    Frontend Changes

    New File: frontend/lib/api/auth.ts
     export async function login(email: string, password: string):
     Promise`<AuthUser>`
     export async function register(email: string, password: string):
     Promise`<AuthUser>`
     export async function logout(): Promise`<void>`
     export async function getSession(): Promise<{ authenticated: boolean;
    user?: AuthUser }>
     export async function refreshToken(): Promise`<boolean>`

    New File: frontend/lib/context/auth-context.tsx
     - AuthProvider 组件
     - useAuth hook
     - 管理用户状态和认证方法

    Modify: frontend/app/login/page.tsx
     - 替换 Supabase Auth UI 为自定义表单
     - 使用 AuthContext

    Modify: frontend/app/(reader)/layout.tsx
     - 使用 authApi.getSession() 替代 supabase.auth.getSession()

    ---
     Phase 2: Data CRUD (Priority 2)

    FastAPI Changes

    New File: backend/app/api/routers/feeds.py

| Method | Path                 | Description            |
| ------ | -------------------- | ---------------------- |
| GET    | /api/feeds           | 获取所有 feeds         |
| POST   | /api/feeds           | 创建/批量 upsert feeds |
| GET    | /api/feeds/{feed_id} | 获取单个 feed          |
| PUT    | /api/feeds/{feed_id} | 更新 feed              |
| DELETE | /api/feeds/{feed_id} | 删除 feed + articles   |

    New File: backend/app/api/routers/articles.py

    | Method | Path                       | Description

|        |                            |                                 |
| ------ | -------------------------- | ------------------------------- |
| -----  |                            |                                 |
| GET    | /api/articles              | 获取 articles (filter: feed_id, |
| limit) |                            |                                 |
| POST   | /api/articles              | 批量创建 articles               |
|        |                            |                                 |
| GET    | /api/articles/{article_id} | 获取单个 article                |
|        |                            |                                 |
| PATCH  | /api/articles/{article_id} | 更新 (is_read, is_starred)      |
|        |                            |                                 |
| DELETE | /api/articles/old          | 清理旧 articles                 |
|        |                            |                                 |
| GET    | /api/articles/stats        | 获取统计信息                    |
|        |                            |                                 |

    New File: backend/app/api/routers/folders.py

| Method | Path                     | Description      |
| ------ | ------------------------ | ---------------- |
| GET    | /api/folders             | 获取所有 folders |
| POST   | /api/folders             | 创建/批量 upsert |
| PUT    | /api/folders/{folder_id} | 更新 folder      |
| DELETE | /api/folders/{folder_id} | 删除 folder      |

    New File: backend/app/api/routers/settings.py

| Method | Path          | Description  |
| ------ | ------------- | ------------ |
| GET    | /api/settings | 获取用户设置 |
| PUT    | /api/settings | 更新设置     |

    Frontend Changes

    New Directory: frontend/lib/api/

    New Files:
     - frontend/lib/api/feeds.ts
     - frontend/lib/api/articles.ts
     - frontend/lib/api/folders.ts
     - frontend/lib/api/settings.ts
     - frontend/lib/api/index.ts

    Modify Store Slices:
     - frontend/lib/store/database.slice.ts - 使用 API 替代 dbManager
     - frontend/lib/store/feeds.slice.ts - 使用 API
     - frontend/lib/store/articles.slice.ts - 使用 API
     - frontend/lib/store/folders.slice.ts - 使用 API
     - frontend/lib/store/settings.slice.ts - 使用 API

    Deprecate (保留作为备份):
     - frontend/lib/db/*.ts

    ---
     Phase 3: Realtime WebSocket (Priority 3)

    FastAPI Changes

    New File: backend/app/services/realtime.py
     - ConnectionManager 类管理 WebSocket 连接

    New File: backend/app/services/supabase_realtime.py
     - SupabaseRealtimeForwarder 类订阅 Supabase postgres_changes

    New File: backend/app/api/routers/websocket.py
     - WS /api/ws/realtime 端点
     - 认证通过 cookie
     - 转发 feeds/articles/folders 变更

    Frontend Changes

    New File: frontend/lib/realtime-ws.ts
     - RealtimeWSManager 类
     - WebSocket 连接、重连、心跳

    Modify: frontend/hooks/use-realtime-sync.ts
     - 使用 RealtimeWSManager 替代 supabase-js Realtime

    Modify: frontend/next.config.mjs
     - WebSocket 代理配置 (或直接连接 FastAPI)

    ---
     Data Flow

    Authentication

    Browser → POST /api/auth/login → FastAPI → Supabase Auth
     Browser ← Set-Cookie: sb_access_token ←

    CRUD

    Browser → GET /api/feeds (Cookie) → FastAPI → FeedService → Supabase DB
    Browser ← JSON: Feed[] ←

    Realtime

    Browser ↔ WebSocket /ws/realtime ↔ FastAPI ↔ Supabase Realtime

    ---
     Critical Files

    FastAPI (to create/modify)

    1. backend/app/schemas/auth.py - NEW
     2. backend/app/api/routers/auth.py - NEW
     3. backend/app/api/routers/feeds.py - NEW
     4. backend/app/api/routers/articles.py - NEW
     5. backend/app/api/routers/folders.py - NEW
     6. backend/app/api/routers/settings.py - NEW
     7. backend/app/api/routers/websocket.py - NEW
     8. backend/app/services/realtime.py - NEW
     9. backend/app/services/supabase_realtime.py - NEW
     10. backend/app/dependencies.py - MODIFY (add cookie auth)
     11. backend/app/main.py - MODIFY (register routers)

    Frontend (to create/modify)

    1. frontend/lib/api/auth.ts - NEW
     2. frontend/lib/api/feeds.ts - NEW
     3. frontend/lib/api/articles.ts - NEW
     4. frontend/lib/api/folders.ts - NEW
     5. frontend/lib/api/settings.ts - NEW
     6. frontend/lib/api/index.ts - NEW
     7. frontend/lib/context/auth-context.tsx - NEW
     8. frontend/lib/realtime-ws.ts - NEW
     9. frontend/app/login/page.tsx - MODIFY
     10. frontend/app/(reader)/layout.tsx - MODIFY
     11. frontend/lib/store/database.slice.ts - MODIFY
     12. frontend/lib/store/feeds.slice.ts - MODIFY
     13. frontend/lib/store/articles.slice.ts - MODIFY
     14. frontend/lib/store/folders.slice.ts - MODIFY
     15. frontend/lib/store/settings.slice.ts - MODIFY
     16. frontend/hooks/use-realtime-sync.ts - MODIFY

    ---
     Migration Order

    Step 1: Phase 1 - Authentication

    1. Create FastAPI auth schemas and router
     2. Add cookie-based auth dependency
     3. Create frontend auth API client
     4. Create AuthContext provider
     5. Update login page
     6. Update layout auth check
     7. Test: Login, logout, session persistence

    Step 2: Phase 2a - Feeds & Folders

    1. Create FastAPI feeds/folders routers
     2. Create frontend API clients
     3. Update store slices
     4. Test: Add/edit/delete feeds and folders

    Step 3: Phase 2b - Articles & Settings

    1. Create FastAPI articles/settings routers
     2. Create frontend API clients
     3. Update store slices
     4. Test: Read/star articles, settings

    Step 4: Phase 3 - Realtime

    1. Create WebSocket manager and Supabase forwarder
     2. Create WebSocket endpoint
     3. Create frontend WebSocket client
     4. Update realtime hook
     5. Test: Multi-tab sync, reconnection

    ---
     Notes

    - 保留 frontend/app/api/ 作为备份
     - 保留 frontend/lib/supabase/ 作为备份
     - 保留 frontend/lib/db/ 作为备份
     - 暂不实现 API 密钥加密
     - 暂不实现 RSS 定时刷新
     - 不包含 Chat 功能
