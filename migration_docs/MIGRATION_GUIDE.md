# Next.js 纯前端化迁移指南

> **目标**: 将 Next.js 前端变成"纯前端"，所有后端逻辑迁移到 FastAPI。

## 1. 架构变更概览

### 迁移前（当前状态）

```
Frontend (Next.js)
├── lib/db/*           # Supabase 直连 CRUD
├── lib/api/*          # FastAPI HTTP Client
├── lib/supabase/*     # Supabase 客户端
├── lib/encryption.ts  # 客户端加密（密钥暴露）
├── app/api/rss/*      # Next.js API Routes
└── lib/realtime.ts    # Supabase Realtime（已弃用）

数据流：
  浏览器 ─┬─> Supabase（直连）
          └─> FastAPI ─> Supabase（代理）
```

### 迁移后（目标状态）

```
Frontend (Next.js)
├── lib/api/*          # 唯一的数据访问层
├── lib/realtime-ws.ts # FastAPI WebSocket
└── (无 Supabase 依赖)

数据流：
  浏览器 ─> FastAPI ─> Supabase
```

## 2. 用户决策汇总

| 决策项 | 选择 | 影响 |
|--------|------|------|
| DB 操作层 | 删除 `lib/db/*`，只用 `lib/api/*` | 约 954 行代码删除 |
| API Routes | 删除 `app/api/rss/*` | 约 148 行代码删除 |
| 加密位置 | 迁移到后端加密 | 移除 NEXT_PUBLIC_ENCRYPTION_SECRET |
| 认证模式 | 统一用 HttpOnly Cookie | 移除 Supabase session 管理 |
| Supabase 客户端 | 完全移除 | 移除 @supabase/ssr, @supabase/supabase-js |
| 实时同步 | 保留 FastAPI WebSocket | 删除 lib/realtime.ts |
| 旧数据处理 | 无旧数据 | 无需数据迁移脚本 |
| Storage 功能 | 暂时禁用 | 前端显示"功能开发中"，后续实现后端 API |

## 3. 迁移批次详解

---

### 批次 0: 后端准备（阻塞其他批次）

**目标**: 补齐后端缺失的 API 端点和加密服务

#### 已存在的组件（无需新建）

以下组件**已经存在**，可直接使用：

| 文件 | 状态 | 说明 |
|-----|------|------|
| `backend/app/schemas/api_configs.py` | ✅ 已存在 | 包含 6 个模型类，比原计划更完整 |
| `backend/app/services/db/api_configs.py` | ✅ 已存在 | 完整 CRUD 服务（226行），但无加密 |

#### 需要新建的文件

#### 1. `backend/app/services/encryption.py`

```python
"""
AES-256-GCM 加密服务
移植自 frontend/lib/encryption.ts
"""
import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ENCRYPTION_SECRET = os.getenv("ENCRYPTION_SECRET", "default-secret-change-me")
SALT = b"rssreader-salt"  # 与前端保持一致
ITERATIONS = 100000

def _derive_key(secret: str) -> bytes:
    """使用 PBKDF2 派生 256-bit 密钥"""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=SALT,
        iterations=ITERATIONS,
    )
    return kdf.derive(secret.encode())

def encrypt(plaintext: str) -> str:
    """加密字符串，返回 base64 编码的密文"""
    key = _derive_key(ENCRYPTION_SECRET)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)  # 96-bit nonce
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    # 格式: base64(nonce + ciphertext)
    return base64.b64encode(nonce + ciphertext).decode()

def decrypt(encrypted: str) -> str:
    """解密 base64 编码的密文"""
    key = _derive_key(ENCRYPTION_SECRET)
    aesgcm = AESGCM(key)
    data = base64.b64decode(encrypted)
    nonce = data[:12]
    ciphertext = data[12:]
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode()
```

#### 2. `backend/app/api/routers/api_configs.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from app.schemas.api_configs import (
    ApiConfigCreate, ApiConfigUpdate, ApiConfigResponse
)
from app.services.db.api_configs import ApiConfigService
from app.services.encryption import encrypt, decrypt
from app.api.deps import verify_auth, get_supabase_client

router = APIRouter(prefix="/api-configs", tags=["api-configs"])

def get_api_config_service(request, user=Depends(verify_auth)):
    access_token = request.cookies.get("sb_access_token")
    client = get_supabase_client(access_token)
    return ApiConfigService(client, user.user.id)

@router.get("", response_model=List[ApiConfigResponse])
async def get_api_configs(service = Depends(get_api_config_service)):
    configs = service.load_api_configs()
    # 解密敏感字段
    for config in configs:
        config["api_key"] = decrypt(config["api_key"]) if config["api_key"] else ""
        config["api_base"] = decrypt(config["api_base"]) if config["api_base"] else ""
    return configs

@router.post("", response_model=ApiConfigResponse)
async def create_api_config(data: ApiConfigCreate, service = Depends(get_api_config_service)):
    # 加密敏感字段
    encrypted_data = data.model_dump()
    encrypted_data["api_key"] = encrypt(data.api_key)
    encrypted_data["api_base"] = encrypt(data.api_base)
    return service.save_api_configs([encrypted_data])

@router.put("/{config_id}", response_model=ApiConfigResponse)
async def update_api_config(config_id: str, data: ApiConfigUpdate, service = Depends(get_api_config_service)):
    updates = data.model_dump(exclude_unset=True)
    if "api_key" in updates:
        updates["api_key"] = encrypt(updates["api_key"])
    if "api_base" in updates:
        updates["api_base"] = encrypt(updates["api_base"])
    return service.update_api_config(config_id, updates)

@router.delete("/{config_id}")
async def delete_api_config(config_id: str, service = Depends(get_api_config_service)):
    service.delete_api_config(config_id)
    return {"success": True}

@router.post("/{config_id}/set-default")
async def set_default_config(config_id: str, service = Depends(get_api_config_service)):
    service.set_default_config(config_id)
    return {"success": True}
```

#### 3. 更新 `backend/app/main.py`

```python
from app.api.routers import api_configs
# ... 在路由注册部分添加:
app.include_router(api_configs.router, prefix="/api")
```

**验证**:
```bash
# 启动后端
cd backend && uvicorn app.main:app --reload

# 测试端点
curl http://localhost:8000/api/api-configs -H "Cookie: sb_access_token=..."
```

---

### 批次 1: 前端 API Client

**目标**: 创建 `lib/api/api-configs.ts`

**新建文件**: `frontend/lib/api/api-configs.ts`

```typescript
/**
 * API Configs HTTP Client
 * 与后端 /api/api-configs 端点通信
 */

import type { ApiConfig } from "../types"

const API_BASE = "/api/backend/api-configs"

interface ApiConfigResponse {
  id: string
  name: string
  api_key: string
  api_base: string
  model: string
  is_default: boolean
  is_active: boolean
  user_id: string
  created_at: string
}

function transformApiConfig(response: ApiConfigResponse): ApiConfig {
  return {
    id: response.id,
    name: response.name,
    apiKey: response.api_key,
    apiBase: response.api_base,
    model: response.model,
    isDefault: response.is_default,
    isActive: response.is_active,
    createdAt: new Date(response.created_at),
  }
}

function toApiFormat(config: Partial<ApiConfig>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (config.name !== undefined) result.name = config.name
  if (config.apiKey !== undefined) result.api_key = config.apiKey
  if (config.apiBase !== undefined) result.api_base = config.apiBase
  if (config.model !== undefined) result.model = config.model
  if (config.isDefault !== undefined) result.is_default = config.isDefault
  if (config.isActive !== undefined) result.is_active = config.isActive
  return result
}

export const apiConfigsApi = {
  async getApiConfigs(): Promise<ApiConfig[]> {
    const response = await fetch(API_BASE, {
      method: "GET",
      credentials: "include",
    })
    if (!response.ok) throw new Error("Failed to fetch API configs")
    const data: ApiConfigResponse[] = await response.json()
    return data.map(transformApiConfig)
  },

  async createApiConfig(config: Omit<ApiConfig, "id" | "createdAt">): Promise<ApiConfig> {
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(toApiFormat(config)),
    })
    if (!response.ok) throw new Error("Failed to create API config")
    return transformApiConfig(await response.json())
  },

  async updateApiConfig(id: string, updates: Partial<ApiConfig>): Promise<ApiConfig> {
    const response = await fetch(`${API_BASE}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(toApiFormat(updates)),
    })
    if (!response.ok) throw new Error("Failed to update API config")
    return transformApiConfig(await response.json())
  },

  async deleteApiConfig(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/${id}`, {
      method: "DELETE",
      credentials: "include",
    })
    if (!response.ok) throw new Error("Failed to delete API config")
  },

  async setDefaultConfig(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/${id}/set-default`, {
      method: "POST",
      credentials: "include",
    })
    if (!response.ok) throw new Error("Failed to set default config")
  },
}
```

---

### 批次 2: Store 层迁移

**目标**: 让 Store 完全使用 `lib/api/*`

**修改文件**:

#### 1. `frontend/lib/store/api-configs.slice.ts`

**改动**: 将所有 `import("../db")` 替换为 `apiConfigsApi` 调用

```typescript
// 删除:
// const { deleteApiConfig: dbDeleteApiConfig } = await import("../db")
// const { saveApiConfigs } = await import("../db")
// const { loadApiConfigs } = await import("../db")

// 添加:
import { apiConfigsApi } from "../api/api-configs"

// syncApiConfigsToSupabase 改为:
syncApiConfigsToSupabase: async () => {
  try {
    const { apiConfigs } = get()
    // 批量保存（后端处理）
    for (const config of apiConfigs) {
      await apiConfigsApi.updateApiConfig(config.id, config)
    }
  } catch (error) {
    // ...
  }
}

// loadApiConfigsFromSupabase 改为:
loadApiConfigsFromSupabase: async () => {
  try {
    set({ isLoading: true, error: null })
    const apiConfigs = await apiConfigsApi.getApiConfigs()
    set({ apiConfigs, isLoading: false })
  } catch (error) {
    // ...
  }
}

// deleteApiConfig 改为:
deleteApiConfig: (id) => {
  const deleteFromDB = async () => {
    try {
      await apiConfigsApi.deleteApiConfig(id)
      set((state) => ({
        apiConfigs: state.apiConfigs.filter((config) => config.id !== id),
      }))
    } catch (error) {
      // ...
    }
  }
  deleteFromDB()
}
```

#### 2. `frontend/lib/store/index.ts`

**改动**: 移除 `defaultSettings` 从 `lib/db` 的导入，改为内联

```typescript
// 删除:
// import { defaultSettings } from "../db"

// 添加内联常量:
const defaultSettings = {
  id: "",
  theme: "system",
  fontSize: 16,
  autoRefresh: true,
  refreshInterval: 30,
  articlesRetentionDays: 30,
  markAsReadOnScroll: true,
  showThumbnails: true,
  updatedAt: new Date(),
}
```

---

### 批次 3: 组件层迁移

**修改文件**:

#### 1. `frontend/components/edit-feed-form.tsx`

**改动**: 替换 `dbManager.updateFeed` 为 `feedsApi.updateFeed`

```typescript
// 删除:
// import { dbManager } from "@/lib/db"

// 添加:
import { feedsApi } from "@/lib/api/feeds"

// 替换调用:
// dbManager.updateFeed(feedId, updates) -> feedsApi.updateFeed(feedId, updates)
```

#### 2. `frontend/app/(reader)/settings/storage/page.tsx`

**改动**: 暂时禁用导入/导出/清除功能（后端 API 待实现）

```typescript
// 方案：禁用按钮并显示提示
<Button disabled className="opacity-50 cursor-not-allowed">
  导出数据
  <span className="ml-2 text-xs text-muted-foreground">(功能开发中)</span>
</Button>

<Button disabled className="opacity-50 cursor-not-allowed">
  导入数据
  <span className="ml-2 text-xs text-muted-foreground">(功能开发中)</span>
</Button>

<Button disabled variant="destructive" className="opacity-50 cursor-not-allowed">
  清除数据
  <span className="ml-2 text-xs text-muted-foreground">(功能开发中)</span>
</Button>

// 删除:
// import { dbManager } from "@/lib/db"
// 以及所有 dbManager.exportData/importData/clearAllData 调用
```

**后续计划**: 实现后端 `/api/data/export`, `/api/data/import`, `/api/data/clear` 端点后再启用

---

### 批次 4: RSS Parser 迁移

**修改文件**: `frontend/lib/rss-parser.ts`

**改动**: 移除 Supabase auth 依赖，使用 Cookie 认证

```typescript
// 删除:
// import { supabase } from "./supabase/client"
// async function getAccessToken() { ... }

// 修改 parseRSSFeed:
export async function parseRSSFeed(url: string, feedId: string) {
  const response = await fetch("/api/backend/rss/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",  // 使用 Cookie 认证
    body: JSON.stringify({ url, feed_id: feedId }),
  })
  // ...
}
```

**后端检查**: 确保 `backend/app/api/routers/rss.py` 使用 `verify_auth`（支持 Cookie）而非 `verify_jwt`（仅 Header）

---

### 批次 5: Auth Context 迁移

**修改文件**: `frontend/lib/context/auth-context.tsx`

**改动**: 移除 Supabase session 管理

```typescript
// 删除:
// import { supabase } from "@/lib/supabase/client"
// async function setSupabaseSession(...) { ... }
// async function clearSupabaseSession() { ... }

// 删除所有对这两个函数的调用:
// login: await setSupabaseSession(...)
// register: await setSupabaseSession(...)
// logout: await clearSupabaseSession()
// checkSession: await setSupabaseSession(...)
```

---

### 批次 6: 删除 API Routes

**删除文件**:
- `frontend/app/api/rss/validate/route.ts`
- `frontend/app/api/rss/parse/route.ts`
- `frontend/app/api/rss/` 目录

---

### 批次 7: 清理

**删除文件**:
```bash
rm frontend/lib/db/core.ts
rm frontend/lib/db/feeds.ts
rm frontend/lib/db/articles.ts
rm frontend/lib/db/folders.ts
rm frontend/lib/db/api-configs.ts
rm frontend/lib/db/settings.ts
rm frontend/lib/db/index.ts
rm frontend/lib/supabase/client.ts
rm frontend/lib/encryption.ts
rm frontend/lib/realtime.ts
```

**保留文件**:
- `frontend/lib/supabase/types.ts` - TypeScript 类型定义仍然有用

**修改 package.json**:
```bash
cd frontend
pnpm remove @supabase/ssr @supabase/supabase-js
```

**修改 .env**:
```diff
- NEXT_PUBLIC_SUPABASE_URL=...
- NEXT_PUBLIC_SUPABASE_ANON_KEY=...
- NEXT_PUBLIC_ENCRYPTION_SECRET=...
+ # Supabase 凭证现在只在后端使用
```

**更新文档**:
- `frontend/CLAUDE.md` - 移除 Supabase 相关章节
- `CLAUDE.md` - 更新架构说明

---

## 4. 验证清单

### 功能验证

- [ ] 登录/注册/登出正常
- [ ] Feed CRUD 正常
- [ ] Article 列表/阅读/标星正常
- [ ] Folder CRUD 正常
- [ ] Settings 保存/加载正常
- [ ] API Config 添加/删除/设为默认正常
- [ ] RSS 解析/验证正常
- [ ] 实时同步（WebSocket）正常
- [ ] 后台刷新（Celery）正常

### 技术验证

- [ ] `pnpm build` 成功
- [ ] `pnpm lint` 无错误
- [ ] 控制台无 Supabase 相关错误
- [ ] Network 面板无直接 Supabase 请求（仅 FastAPI）

---

## 5. 回滚策略

### 批次级别回滚

```bash
# 保存当前改动
git stash

# 回滚特定文件
git checkout HEAD -- <file-path>
```

### 完整回滚

```bash
# 回滚到迁移开始前
git checkout <commit-before-migration>
```

### 迁移期间的共存

每个批次完成后创建 commit，便于精确回滚：

```bash
git commit -m "chore: batch 0 - add backend api_configs endpoint"
git commit -m "chore: batch 1 - add frontend api-configs client"
# ...
```

---

## 6. 依赖关系图

```
批次 0 (后端准备)
    │
    ▼
批次 1 (前端 API Client)
    │
    ▼
批次 2 (Store 层) ──────┐
    │                  │
    ▼                  ▼
批次 3 (组件层)    批次 4 (RSS Parser)
    │                  │
    └───────┬──────────┘
            │
            ▼
      批次 5 (Auth Context)
            │
            ▼
      批次 6 (删除 API Routes)
            │
            ▼
      批次 7 (清理)
```

**关键依赖**:
- 批次 0 必须先完成（后端端点）
- 批次 1 必须在批次 2 之前（API Client）
- 批次 7 必须最后执行（清理）

---

## 7. 常见问题

### Q: 后端 `verify_auth` 和 `verify_jwt` 有什么区别？

**A**:
- `verify_jwt`: 仅支持 `Authorization: Bearer <token>` header
- `verify_auth`: 优先使用 Cookie，回退到 Header（推荐）

### Q: 为什么保留 `lib/supabase/types.ts`？

**A**: TypeScript 类型定义仍然有用，用于保持前后端数据类型一致。

### Q: 迁移后还能使用 Supabase Dashboard 吗？

**A**: 可以。后端仍然使用 Supabase 作为数据库，只是前端不再直接连接。

### Q: 加密密钥如何管理？

**A**:
- 前端：不再需要 `ENCRYPTION_SECRET`
- 后端：在 `.env` 中设置 `ENCRYPTION_SECRET`
