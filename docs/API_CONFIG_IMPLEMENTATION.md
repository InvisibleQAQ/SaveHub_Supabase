# API配置功能实现说明

## 功能概述

新增了用户API配置管理功能，支持：
- 用户可以配置多个API密钥组合（api_key, api_base, model）
- API密钥和API Base URL使用AES-GCM加密存储
- 每个用户只能看到自己的配置（RLS隔离）
- 支持设置默认配置
- 支持启用/禁用配置

## 数据库设置

在使用此功能前，需要在Supabase SQL编辑器中依次运行以下脚本：

### 1. 创建API配置表
运行 `scripts/006_create_api_configs_table.sql`:
```sql
-- 创建api_configs表，包含基本结构和索引
```

### 2. 启用RLS安全策略
运行 `scripts/007_add_rls_to_api_configs.sql`:
```sql
-- 添加user_id字段，启用RLS，确保用户隔离
```

## 使用步骤

1. **访问设置页面**
   - 访问 `/settings/api` 或点击设置中的"API Configuration"

2. **设置主密码**
   - 首次使用需要设置主密码
   - 该密码用于加密/解密API密钥
   - ⚠️ **重要**: 主密码不会存储，忘记后无法恢复已保存的API配置

3. **添加API配置**
   - 点击"添加配置"按钮
   - 填写配置名称、API Key、API Base URL、模型名称
   - 可选择是否设为默认配置

4. **管理配置**
   - 编辑：修改现有配置
   - 删除：删除不需要的配置
   - 设为默认：选择默认使用的配置
   - 启用/禁用：临时关闭某个配置

## 安全特性

### 加密存储
- 使用WebCrypto API的AES-GCM算法
- PBKDF2密钥派生（100,000次迭代）
- 每次加密使用随机IV和salt
- 只有api_key和api_base字段被加密

### 用户隔离
- 使用Supabase RLS（行级安全）
- 每个用户只能访问自己的API配置
- 数据库级别的安全隔离

### 密钥管理
- 主密码仅存储在内存中
- 页面刷新后需要重新输入主密码
- 解密失败时不会破坏应用运行

## 技术实现

### 数据结构
```typescript
interface ApiConfig {
  id: string
  name: string
  apiKey: string      // 加密存储
  apiBase: string     // 加密存储
  model: string
  isDefault: boolean
  isActive: boolean
  createdAt: Date
}
```

### 加密流程
1. 用户输入主密码 → 2. 使用PBKDF2派生密钥 → 3. AES-GCM加密 → 4. Base64编码存储

### 解密流程
1. 从数据库读取 → 2. Base64解码 → 3. 提取salt/IV → 4. 派生密钥 → 5. AES-GCM解密

## 注意事项

⚠️ **主密码管理**
- 主密码不会持久化存储
- 建议使用强密码
- 忘记主密码将无法访问已保存的API配置

⚠️ **数据迁移**
- 新功能，无需迁移现有数据
- 如果您之前手动创建了api_configs表，请删除后重新运行脚本

⚠️ **浏览器兼容性**
- 需要支持WebCrypto API的现代浏览器
- 不支持HTTP环境（需要HTTPS或localhost）

## 文件清单

### 新增文件
- `lib/crypto.ts` - 加密/解密工具
- `lib/db/api-configs.ts` - 数据库操作
- `lib/store/api-configs.slice.ts` - Zustand状态管理
- `app/(reader)/settings/api/page.tsx` - UI界面
- `scripts/006_create_api_configs_table.sql` - 创建表结构
- `scripts/007_add_rls_to_api_configs.sql` - 启用RLS

### 修改文件
- `lib/types.ts` - 添加ApiConfig类型
- `lib/store/index.ts` - 集成API配置slice
- `lib/store/database.slice.ts` - 添加同步逻辑
- `lib/db/index.ts` - 添加API配置操作
- `lib/db/core.ts` - 更新数据库检查
- `app/(reader)/settings/layout.tsx` - 添加API配置菜单