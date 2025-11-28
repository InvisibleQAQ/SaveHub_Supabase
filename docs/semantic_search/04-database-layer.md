# Phase 4: 数据库层更新

## 概述

更新数据库操作层，支持 embedding 字段的读写和语义搜索。

## 修改文件

### 1. `lib/db/api-configs.ts`

更新 `saveApiConfigs` 和 `loadApiConfigs` 函数，添加 embedding 字段的加密/解密处理。

#### 1.1 更新 `saveApiConfigs`

在现有映射逻辑中添加 embedding 字段：

```typescript
import { encrypt, decrypt, isEncrypted } from "../encryption"

export async function saveApiConfigs(configs: ApiConfig[]): Promise<{ success: boolean; error?: string }> {
  const userId = await getCurrentUserId()

  const dbRows = await Promise.all(configs.map(async (config) => ({
    id: config.id,
    name: config.name,
    // 现有字段...
    api_key: await encrypt(config.apiKey),
    api_base: await encrypt(config.apiBase),
    model: config.model,
    is_default: config.isDefault,
    is_active: config.isActive,
    created_at: toISOString(config.createdAt),
    user_id: userId,
    // ===== 新增 embedding 字段 =====
    embedding_api_key: config.embeddingApiKey ? await encrypt(config.embeddingApiKey) : null,
    embedding_api_base: config.embeddingApiBase ? await encrypt(config.embeddingApiBase) : null,
    embedding_model: config.embeddingModel || null,
    embedding_dimensions: config.embeddingDimensions || 1536,
  })))

  // ... 其余逻辑不变
}
```

#### 1.2 更新 `loadApiConfigs`

在返回映射中添加 embedding 字段解密：

```typescript
export async function loadApiConfigs(): Promise<ApiConfig[]> {
  const { data, error } = await supabase
    .from("api_configs")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    logger.error({ error }, 'Failed to load API configs')
    throw error
  }

  return Promise.all((data || []).map(async (row) => ({
    id: row.id,
    name: row.name,
    // 现有字段解密...
    apiKey: isEncrypted(row.api_key) ? await decrypt(row.api_key) : row.api_key,
    apiBase: isEncrypted(row.api_base) ? await decrypt(row.api_base) : row.api_base,
    model: row.model,
    isDefault: row.is_default,
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
    // ===== 新增 embedding 字段解密 =====
    embeddingApiKey: row.embedding_api_key
      ? (isEncrypted(row.embedding_api_key) ? await decrypt(row.embedding_api_key) : row.embedding_api_key)
      : undefined,
    embeddingApiBase: row.embedding_api_base
      ? (isEncrypted(row.embedding_api_base) ? await decrypt(row.embedding_api_base) : row.embedding_api_base)
      : undefined,
    embeddingModel: row.embedding_model || undefined,
    embeddingDimensions: row.embedding_dimensions || 1536,
  })))
}
```

### 2. `lib/db/articles.ts`

更新文章相关的数据库操作。

#### 2.1 更新 `saveArticles`

在映射中添加 embedding 字段：

```typescript
export async function saveArticles(articles: Article[]): Promise<void> {
  const userId = await getCurrentUserId()

  const dbRows = articles.map(article => ({
    id: article.id,
    feed_id: article.feedId,
    title: article.title,
    content: article.content,
    summary: article.summary || null,
    url: article.url,
    author: article.author || null,
    published_at: toISOString(article.publishedAt),
    is_read: article.isRead,
    is_starred: article.isStarred,
    thumbnail: article.thumbnail || null,
    content_hash: article.contentHash || null,
    user_id: userId,
    // ===== 新增 embedding 字段 =====
    embedding: article.embedding || null,
    embedding_status: article.embeddingStatus || 'pending',
  }))

  // ... 其余逻辑不变
}
```

#### 2.2 更新 `loadArticles`

在返回映射中添加 embedding 字段：

```typescript
export async function loadArticles(feedId?: string, limit?: number): Promise<Article[]> {
  // ... 查询逻辑不变

  return (data || []).map(row => ({
    id: row.id,
    feedId: row.feed_id,
    title: row.title,
    content: row.content,
    summary: row.summary || undefined,
    url: row.url,
    author: row.author || undefined,
    publishedAt: new Date(row.published_at),
    isRead: row.is_read,
    isStarred: row.is_starred,
    thumbnail: row.thumbnail || undefined,
    contentHash: row.content_hash || undefined,
    // ===== 新增 embedding 字段 =====
    embedding: row.embedding || undefined,
    embeddingStatus: row.embedding_status || 'pending',
  }))
}
```

#### 2.3 新增 `updateArticleEmbedding`

```typescript
/**
 * 更新文章的 embedding
 */
export async function updateArticleEmbedding(
  articleId: string,
  embedding: number[] | null,
  status: 'completed' | 'failed' | 'skipped'
): Promise<void> {
  logger.debug({ articleId, status, embeddingLength: embedding?.length }, 'Updating article embedding')

  const { error } = await supabase
    .from("articles")
    .update({
      embedding,
      embedding_status: status,
    })
    .eq("id", articleId)

  if (error) {
    logger.error({ error, articleId }, 'Failed to update article embedding')
    throw error
  }

  logger.debug({ articleId, status }, 'Article embedding updated successfully')
}
```

#### 2.4 新增 `getArticlesPendingEmbedding`

```typescript
/**
 * 获取待生成 embedding 的文章
 */
export async function getArticlesPendingEmbedding(
  limit: number = 100
): Promise<Article[]> {
  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .in("embedding_status", ['pending', 'failed'])
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    logger.error({ error }, 'Failed to load articles pending embedding')
    throw error
  }

  return (data || []).map(row => ({
    // ... 同 loadArticles 的映射逻辑
  }))
}
```

### 3. 新建 `lib/db/search.ts`

```typescript
import { supabase } from "../supabase/client"
import { logger } from "../logger"
import type { SearchResult } from "../types"

export interface SemanticSearchParams {
  queryEmbedding: number[]
  matchThreshold?: number
  matchCount?: number
}

/**
 * 执行语义搜索
 */
export async function semanticSearch(params: SemanticSearchParams): Promise<SearchResult[]> {
  const {
    queryEmbedding,
    matchThreshold = 0.5,
    matchCount = 20,
  } = params

  logger.debug({ matchThreshold, matchCount, embeddingLength: queryEmbedding.length }, 'Performing semantic search')

  const { data, error } = await supabase.rpc('search_articles_semantic', {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
  })

  if (error) {
    logger.error({ error }, 'Semantic search failed')
    throw error
  }

  logger.info({ resultCount: data?.length || 0 }, 'Semantic search completed')

  return (data || []).map(row => ({
    id: row.id,
    feedId: row.feed_id,
    title: row.title,
    content: row.content,
    summary: row.summary || undefined,
    url: row.url,
    author: row.author || undefined,
    publishedAt: new Date(row.published_at),
    isRead: row.is_read,
    isStarred: row.is_starred,
    thumbnail: row.thumbnail || undefined,
    similarity: row.similarity,
  }))
}

/**
 * 获取 embedding 统计信息
 */
export async function getEmbeddingStats(): Promise<{
  total: number
  completed: number
  pending: number
  failed: number
}> {
  const { data, error } = await supabase
    .from("articles")
    .select("embedding_status")

  if (error) {
    logger.error({ error }, 'Failed to get embedding stats')
    throw error
  }

  const stats = {
    total: data?.length || 0,
    completed: 0,
    pending: 0,
    failed: 0,
  }

  data?.forEach(row => {
    switch (row.embedding_status) {
      case 'completed':
        stats.completed++
        break
      case 'pending':
        stats.pending++
        break
      case 'failed':
        stats.failed++
        break
    }
  })

  return stats
}
```

### 4. 更新 `lib/db/index.ts`

导出新的搜索模块：

```typescript
// 现有导出...
export * from "./feeds"
export * from "./articles"
export * from "./folders"
export * from "./api-configs"

// ===== 新增 =====
export * from "./search"
```

## 验证

### 测试 embedding 更新

```typescript
import { updateArticleEmbedding } from '@/lib/db/articles'

// 模拟 embedding 数据
const fakeEmbedding = new Array(1536).fill(0).map(() => Math.random())

await updateArticleEmbedding('article-uuid', fakeEmbedding, 'completed')
```

### 测试语义搜索

```typescript
import { semanticSearch } from '@/lib/db/search'

// 模拟查询 embedding
const queryEmbedding = new Array(1536).fill(0).map(() => Math.random())

const results = await semanticSearch({
  queryEmbedding,
  matchThreshold: 0.3,
  matchCount: 10,
})

console.log('Search results:', results)
```

## 下一步

完成数据库层更新后，继续 [Phase 5: Store 集成](./05-store-integration.md)
