# Phase 2: TypeScript 类型定义更新

## 概述

更新 TypeScript 类型定义，为 embedding 相关字段添加类型支持。

## 修改文件

### 1. `lib/types.ts`

#### 1.1 更新 ApiConfigSchema

在现有 `ApiConfigSchema` 中添加 embedding 相关字段：

```typescript
export const ApiConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  apiKey: z.string(),
  apiBase: z.string(),
  model: z.string(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
  // ===== 新增 embedding 字段 =====
  embeddingApiKey: z.string().optional(),
  embeddingApiBase: z.string().optional(),
  embeddingModel: z.string().optional(),
  embeddingDimensions: z.number().int().min(128).max(4096).default(1536),
})
```

#### 1.2 更新 ArticleSchema

在现有 `ArticleSchema` 中添加 embedding 相关字段：

```typescript
export const ArticleSchema = z.object({
  id: z.string(),
  feedId: z.string(),
  title: z.string(),
  content: z.string(),
  summary: z.string().optional(),
  url: z.string().url(),
  author: z.string().optional(),
  publishedAt: z.date(),
  isRead: z.boolean().default(false),
  isStarred: z.boolean().default(false),
  thumbnail: z.string().optional(),
  contentHash: z.string().optional(),
  // ===== 新增 embedding 字段 =====
  embedding: z.array(z.number()).optional(),
  embeddingStatus: z.enum(['pending', 'completed', 'failed', 'skipped']).default('pending'),
})
```

#### 1.3 新增 SearchResult 类型

在文件末尾添加：

```typescript
// ===== 语义搜索结果类型 =====

export const SearchResultSchema = z.object({
  id: z.string(),
  feedId: z.string(),
  title: z.string(),
  content: z.string(),
  summary: z.string().optional(),
  url: z.string(),
  author: z.string().optional(),
  publishedAt: z.date(),
  isRead: z.boolean(),
  isStarred: z.boolean(),
  thumbnail: z.string().optional(),
  similarity: z.number(), // 0-1 之间的相似度分数
})

export type SearchResult = z.infer<typeof SearchResultSchema>

// Embedding 配置类型（从 ApiConfig 中提取）
export interface EmbeddingConfig {
  apiKey: string
  apiBase: string
  model: string
  dimensions: number
}

// 搜索参数类型
export interface SemanticSearchParams {
  query: string
  matchThreshold?: number  // 默认 0.5
  matchCount?: number      // 默认 20
}
```

### 2. `lib/supabase/types.ts`（如果手动维护）

如果你手动维护 Supabase 类型文件，需要添加：

```typescript
// 在 api_configs 表类型中添加
api_configs: {
  Row: {
    // ... 现有字段
    embedding_api_key: string | null
    embedding_api_base: string | null
    embedding_model: string | null
    embedding_dimensions: number
  }
  Insert: {
    // ... 现有字段
    embedding_api_key?: string | null
    embedding_api_base?: string | null
    embedding_model?: string | null
    embedding_dimensions?: number
  }
  Update: {
    // ... 现有字段
    embedding_api_key?: string | null
    embedding_api_base?: string | null
    embedding_model?: string | null
    embedding_dimensions?: number
  }
}

// 在 articles 表类型中添加
articles: {
  Row: {
    // ... 现有字段
    embedding: number[] | null  // pgvector 在 JS 中表示为数组
    embedding_status: string
  }
  Insert: {
    // ... 现有字段
    embedding?: number[] | null
    embedding_status?: string
  }
  Update: {
    // ... 现有字段
    embedding?: number[] | null
    embedding_status?: string
  }
}
```

> **提示**: 如果使用 `supabase gen types typescript` 自动生成类型，执行数据库迁移后重新生成即可。

## 验证

确保 TypeScript 编译通过：

```bash
pnpm build
```

或检查类型：

```bash
pnpm tsc --noEmit
```

## 完整的类型定义示例

更新后的 `lib/types.ts` 关键部分：

```typescript
import { z } from "zod"

// ===== API 配置 =====
export const ApiConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  apiKey: z.string(),
  apiBase: z.string(),
  model: z.string(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
  // Embedding 配置
  embeddingApiKey: z.string().optional(),
  embeddingApiBase: z.string().optional(),
  embeddingModel: z.string().optional(),
  embeddingDimensions: z.number().int().min(128).max(4096).default(1536),
})

export type ApiConfig = z.infer<typeof ApiConfigSchema>

// ===== 文章 =====
export const ArticleSchema = z.object({
  id: z.string(),
  feedId: z.string(),
  title: z.string(),
  content: z.string(),
  summary: z.string().optional(),
  url: z.string().url(),
  author: z.string().optional(),
  publishedAt: z.date(),
  isRead: z.boolean().default(false),
  isStarred: z.boolean().default(false),
  thumbnail: z.string().optional(),
  contentHash: z.string().optional(),
  // Embedding 字段
  embedding: z.array(z.number()).optional(),
  embeddingStatus: z.enum(['pending', 'completed', 'failed', 'skipped']).default('pending'),
})

export type Article = z.infer<typeof ArticleSchema>

// ===== 搜索结果 =====
export const SearchResultSchema = z.object({
  id: z.string(),
  feedId: z.string(),
  title: z.string(),
  content: z.string(),
  summary: z.string().optional(),
  url: z.string(),
  author: z.string().optional(),
  publishedAt: z.date(),
  isRead: z.boolean(),
  isStarred: z.boolean(),
  thumbnail: z.string().optional(),
  similarity: z.number(),
})

export type SearchResult = z.infer<typeof SearchResultSchema>

export interface EmbeddingConfig {
  apiKey: string
  apiBase: string
  model: string
  dimensions: number
}

export interface SemanticSearchParams {
  query: string
  matchThreshold?: number
  matchCount?: number
}
```

## 下一步

完成类型定义后，继续 [Phase 3: Embedding 服务实现](./03-embedding-service.md)
