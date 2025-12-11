# Next.js 纯前端化迁移 - TODO 清单

> **状态图例**: ⬜ 待开始 | 🔄 进行中 | ✅ 已完成 | ❌ 已阻塞

---

## 批次 0: 后端准备（阻塞其他批次）

### 已存在的组件（无需新建）

- [X] `backend/app/schemas/api_configs.py` - **已存在**（72行，包含6个模型类）
- [X] `backend/app/services/db/api_configs.py` - **已存在**（226行，完整CRUD，无加密）

### 新建文件

- [X] `backend/app/services/encryption.py`

  - 实现 `_derive_key()` - PBKDF2 密钥派生
  - 实现 `encrypt()` - AES-256-GCM 加密
  - 实现 `decrypt()` - AES-256-GCM 解密
  - 添加 `cryptography` 到 `requirements.txt`
- [X] `backend/app/api/routers/api_configs.py`

  - `GET /api/api-configs` - 获取配置列表（解密后返回）
  - `POST /api/api-configs` - 创建配置（加密后存储）
  - `PUT /api/api-configs/{id}` - 更新配置
  - `DELETE /api/api-configs/{id}` - 删除配置
  - `POST /api/api-configs/{id}/set-default` - 设为默认

### 修改文件

- [X] `backend/app/main.py`
  - 导入 `api_configs` router
  - 注册路由：`app.include_router(api_configs.router, prefix="/api")`

### 验证

- [X] 启动后端，测试所有端点
- [X] 确认加密/解密工作正常

---

## 批次 1: 前端 API Client

### 新建文件

- [X] `frontend/lib/api/api-configs.ts`
  - `getApiConfigs()` - 获取配置列表
  - `createApiConfig()` - 创建配置
  - `updateApiConfig()` - 更新配置
  - `deleteApiConfig()` - 删除配置
  - `setDefaultConfig()` - 设为默认
  - 类型转换函数 `transformApiConfig()`, `toApiFormat()`

### 验证

- [X] 在浏览器控制台测试 API 调用

---

## 批次 2: Store 层迁移

### 修改文件

- [X] `frontend/lib/store/api-configs.slice.ts`

  - 删除 `import("../db")` 动态导入
  - 添加 `import { apiConfigsApi } from "../api/api-configs"`
  - 重写 `syncApiConfigsToSupabase()`
  - 重写 `loadApiConfigsFromSupabase()`
  - 重写 `deleteApiConfig()`
  - 重写 `addApiConfig()` - 调用 `apiConfigsApi.createApiConfig()`
  - 重写 `setDefaultApiConfig()` - 调用 `apiConfigsApi.setDefaultConfig()`
- [X] `frontend/lib/store/index.ts`

  - 删除 `import { defaultSettings } from "../db"`
  - 内联 `defaultSettings` 常量

### 验证

- [X] `/settings/api` 页面加载配置列表
- [X] 添加/删除/编辑配置
- [X] 刷新页面后数据持久化

---

## 批次 3: 组件层迁移

### 修改文件

- [X] `frontend/components/edit-feed-form.tsx`

  - 删除 `import { dbManager } from "@/lib/db"`
  - 添加 `import { feedsApi } from "@/lib/api/feeds"`
  - 替换 `dbManager.updateFeed()` → `feedsApi.updateFeed()`
- [X] `frontend/app/(reader)/settings/storage/page.tsx`

  - 删除 `import { dbManager } from "@/lib/db"`
  - 禁用 export/import/clear 按钮
  - 添加"功能开发中"提示文字
  - 删除 `dbManager.exportData()`, `dbManager.importData()`, `dbManager.clearAllData()` 调用

### 验证

- [ ] 编辑 Feed 属性并保存
- [ ] Storage 页面显示禁用按钮和提示

---

## 批次 4: RSS Parser 迁移

### 修改文件

- [X] `frontend/lib/rss-parser.ts`
  - 删除 `import { supabase } from "./supabase/client"`
  - 删除 `getAccessToken()` 函数
  - 修改 `parseRSSFeed()` - 使用 `credentials: "include"`
  - 修改 `validateRSSUrl()` - 使用 `credentials: "include"`

### 后端检查

- [X] 确认 `backend/app/api/routers/rss.py` 使用 `verify_auth`（非 `verify_jwt`）
  - 已将 `verify_jwt` 改为 `verify_auth`

### 验证

- [ ] 添加新 Feed 成功
- [ ] 手动刷新 Feed 获取新文章

---

## 批次 5: Auth Context 迁移

### 修改文件

- [X] `frontend/lib/context/auth-context.tsx`
  - 删除 `import { supabase } from "@/lib/supabase/client"`
  - 删除 `setSupabaseSession()` 函数
  - 删除 `clearSupabaseSession()` 函数
  - 删除 `login()` 中的 `await setSupabaseSession(...)`
  - 删除 `register()` 中的 `await setSupabaseSession(...)`
  - 删除 `logout()` 中的 `await clearSupabaseSession()`
  - 删除 `checkSession()` 中的 `await setSupabaseSession(...)`

### 验证

- [ ] 登录成功
- [ ] 注册成功
- [ ] 登出成功
- [ ] 刷新页面保持登录状态

---

## 批次 6: 删除 API Routes

### 删除文件

- [X] `frontend/app/api/rss/validate/route.ts`
- [X] `frontend/app/api/rss/parse/route.ts`
- [X] `frontend/app/api/rss/` 目录

### 验证

- [X] `pnpm build` 成功
- [ ] RSS 相关功能仍然正常（通过 FastAPI）

---

## 批次 7: 清理

### 删除文件

- [X] `frontend/lib/db/core.ts`
- [X] `frontend/lib/db/feeds.ts`
- [X] `frontend/lib/db/articles.ts`
- [X] `frontend/lib/db/folders.ts`
- [X] `frontend/lib/db/api-configs.ts`
- [X] `frontend/lib/db/settings.ts`
- [X] `frontend/lib/db/index.ts`
- [X] `frontend/lib/db/` 目录
- [X] `frontend/lib/supabase/client.ts`
- [X] `frontend/lib/encryption.ts`
- [X] `frontend/lib/realtime.ts` (已不存在)

### 保留文件

- [X] `frontend/lib/supabase/types.ts` - TypeScript 类型定义

### 移除依赖

- [X] `cd frontend && pnpm remove @supabase/ssr @supabase/supabase-js`

### 更新环境变量

- [X] `frontend/.env`

  - 删除 `NEXT_PUBLIC_SUPABASE_URL`
  - 删除 `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - 删除 `NEXT_PUBLIC_ENCRYPTION_SECRET`
  - 删除 `ENCRYPTION_SECRET`（前端不再需要）
- [X] `frontend/.env.example`

  - 同步更新

### 更新文档

- [X] `frontend/CLAUDE.md`

  - 移除 Supabase 客户端相关章节
  - 更新架构说明
  - 更新环境变量章节
- [X] `CLAUDE.md`（项目根目录）

  - 更新架构图
  - 移除 Supabase 直连相关说明

### 最终验证

- [ ] `pnpm build` 成功
- [ ] `pnpm lint` 无错误
- [ ] 所有页面功能正常
- [ ] 控制台无错误
- [ ] Network 面板无直接 Supabase 请求

---

## Git 提交记录模板

```bash
# 批次 0
git commit -m "feat(backend): add api_configs CRUD endpoints with encryption"

# 批次 1
git commit -m "feat(frontend): add api-configs API client"

# 批次 2
git commit -m "refactor(store): migrate api-configs slice to use HTTP API"

# 批次 3
git commit -m "refactor(components): remove lib/db dependencies"

# 批次 4
git commit -m "refactor(rss-parser): use cookie auth instead of Supabase JWT"

# 批次 5
git commit -m "refactor(auth): remove Supabase session management"

# 批次 6
git commit -m "chore(frontend): remove Next.js API routes"

# 批次 7
git commit -m "chore(frontend): remove Supabase client and lib/db"
```

---

## 风险追踪

| 风险                | 状态      | 缓解措施                       |
| ------------------- | --------- | ------------------------------ |
| 加密算法不兼容      | ⬜ 未确认 | 使用相同的 PBKDF2+AES-GCM 参数 |
| RSS Cookie 认证失败 | ✅ 已解决 | 后端已改用 `verify_auth` 依赖  |
| 数据导出/导入功能   | ✅ 已决策 | 暂时禁用，后续实现后端 API     |

---

## 进度统计

- **批次 0**: 5/5 完成 ✅
- **批次 1**: 2/2 完成 ✅
- **批次 2**: 2/5 完成 (代码已完成，待验证)
- **批次 3**: 2/3 完成 (代码已完成，待验证)
- **批次 4**: 2/4 完成 (代码已完成，待验证)
- **批次 5**: 1/5 完成 (代码已完成，待验证)
- **批次 6**: 4/5 完成 (删除完成，待功能验证)
- **批次 7**: 16/18 完成 (文件删除+依赖移除+环境变量+文档更新完成，待最终验证)

**总进度**: 34/49 完成 (69%)
