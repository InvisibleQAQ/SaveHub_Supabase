# API配置功能实现说明

## 功能概述

新增了用户API配置管理功能，支持：

- 用户可以配置多个API密钥组合（api_key, api_base, model）
- **API密钥和API Base URL使用服务端AES-GCM加密存储**
- 每个用户只能看到自己的配置（RLS隔离）
- 支持设置默认配置
- 支持启用/禁用配置

## 安全特性

### 🔐 服务端加密存储（参考 LobeChat 实现）

**加密算法**: AES-GCM (256-bit)
**密钥管理**: 环境变量 `ENCRYPTION_SECRET`
**数据格式**: Base64(IV + Ciphertext)

#### 为什么这样设计？

参考 LobeChat 的 KeyVaultsGateKeeper 实现，采用服务端加密方案而非客户端主密码方案的原因:

1. **零用户摩擦** - 用户无需记忆和输入主密码
2. **自动迁移** - 首次读取明文数据时自动转换为加密存储
3. **透明加密** - 对用户完全透明，无感知
4. **数据库泄露保护** - 即使数据库被攻破，密钥仍安全（密钥存储在环境变量，与数据库隔离）

#### 加密流程

```
用户输入 API Key
    ↓
[lib/db/api-configs.ts: saveApiConfigs()]
    ↓
encrypt(apiKey) → 使用 ENCRYPTION_SECRET 派生密钥 → AES-GCM 加密 → Base64 编码
    ↓
存储到 Supabase api_configs 表
```

#### 解密流程

```
从 Supabase 读取加密数据
    ↓
[lib/db/api-configs.ts: loadApiConfigs()]
    ↓
检测是否加密 → 解密(Base64 解码 → AES-GCM 解密) → 返回明文
    ↓
Zustand store 中存储明文（仅内存）
```

### 用户隔离

- 使用Supabase RLS（行级安全）
- 每个用户只能访问自己的API配置
- 数据库级别的安全隔离

### 密钥管理

- **ENCRYPTION_SECRET 通过环境变量配置，不存储在代码中**
- **必须至少 32 字符，使用 `openssl rand -base64 32` 生成**
- 生产环境应使用专用密钥管理服务（如 AWS KMS, Azure Key Vault）

## 环境变量配置

### 必需配置

在 `.env` 文件中添加:

```bash
# 生成密钥: openssl rand -base64 32
ENCRYPTION_SECRET=your-generated-secret-key-here
```

⚠️ **警告**:

- 不要将此密钥提交到 Git 仓库
- 生产环境使用独立的密钥
- 密钥丢失将无法解密已存储的 API keys

## 数据库设置

在使用此功能前，需要在Supabase SQL编辑器中依次运行以下脚本：

### 1. 创建API配置表

运行 `scripts/006_create_api_configs_table.sql`:

```sql
-- 创建api_configs表，包含基本结构和索引
-- api_key 和 api_base 字段存储 AES-GCM 加密后的 base64 字符串
```

### 2. 启用RLS安全策略

运行 `scripts/007_add_rls_to_api_configs.sql`:

```sql
-- 添加user_id字段，启用RLS，确保用户隔离
```

## 使用步骤

1. **访问设置页面**

   - 访问 `/settings/api` 或点击设置中的"API Configuration"
2. **添加API配置**

   - 点击"添加配置"按钮
   - 填写配置名称、API Key、API Base URL、模型名称
   - 可选择是否设为默认配置
   - **保存后自动加密存储到数据库**
3. **管理配置**

   - 编辑：修改现有配置（自动重新加密）
   - 删除：删除不需要的配置
   - 设为默认：选择默认使用的配置
   - 启用/禁用：临时关闭某个配置

## 技术实现

### 数据结构

```typescript
interface ApiConfig {
  id: string
  name: string
  apiKey: string      // 应用层明文，数据库层加密
  apiBase: string     // 应用层明文，数据库层加密
  model: string
  isDefault: boolean
  isActive: boolean
  createdAt: Date
}
```

### 核心文件

#### 加密工具 (`lib/encryption.ts`)

```typescript
encrypt(plaintext: string): Promise<string>  // 加密并返回 base64
decrypt(ciphertext: string): Promise<string> // 解密 base64 字符串
isEncrypted(data: string): boolean           // 检测是否已加密
```

#### 数据库管理 (`lib/db/api-configs.ts`)

- `saveApiConfigs()`: 保存前自动加密 apiKey/apiBase
- `loadApiConfigs()`: 读取后自动解密，支持明文数据自动迁移
- `deleteApiConfig()`: 删除配置

### 自动数据迁移

如果检测到数据库中存在明文数据（旧版本或手动添加），系统会：

1. 首次读取时识别明文数据
2. 使用 `setTimeout` 异步自动重新保存为加密格式
3. 日志输出迁移信息: `[DB] Auto-encrypting legacy config {id}`

无需手动操作，零停机迁移。

## 注意事项

⚠️ **密钥管理**

- `ENCRYPTION_SECRET` 必须在启动前配置
- 密钥丢失 = 所有 API keys 永久丢失
- 建议使用密钥管理服务（KMS）而非裸环境变量

⚠️ **数据迁移**

- 自动检测并迁移明文数据
- 无需手动干预
- 迁移过程透明，不影响用户使用

⚠️ **浏览器兼容性**

- 加密在服务端执行（Node.js Crypto API）
- 无浏览器兼容性要求
- 支持所有现代浏览器

## 文件清单

### 新增文件

- `lib/encryption.ts` - AES-GCM 加密/解密工具（服务端）
- `lib/db/api-configs.ts` - 数据库操作（含加密逻辑）
- `app/(reader)/settings/api/page.tsx` - UI界面
- `scripts/006_create_api_configs_table.sql` - 创建表结构
- `scripts/007_add_rls_to_api_configs.sql` - 启用RLS
- `.env.example` - 环境变量模板

### 修改文件

- `lib/types.ts` - 添加ApiConfig类型
- `lib/store/index.ts` - 集成API配置状态
- `.env` - 添加 ENCRYPTION_SECRET 配置

## 与 LobeChat 的对比

| 特性       | 本项目                     | LobeChat          |
| ---------- | -------------------------- | ----------------- |
| 加密算法   | AES-GCM 256-bit            | AES-GCM           |
| 密钥管理   | ENCRYPTION_SECRET 环境变量 | KEY_VAULTS_SECRET |
| 密钥派生   | PBKDF2 (100,000 次迭代)    | 类似实现          |
| 数据格式   | Base64(IV+Ciphertext)      | 相同              |
| 自动迁移   | ✅ 支持明文自动加密        | ✅                |
| 客户端加密 | ❌ 服务端加密              | ❌ 服务端加密     |
