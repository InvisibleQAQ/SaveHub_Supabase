# Phase 6: 搜索 API 路由

## 概述

创建搜索 API 端点，处理语义搜索请求。

## 新建文件

### `app/api/search/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { decrypt, isEncrypted } from "@/lib/encryption"
import { generateEmbedding } from "@/lib/embedding"
import { logger } from "@/lib/logger"

// Supabase 客户端（服务端）
function createServerClient() {
  const cookieStore = cookies()
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
      },
    }
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { query, matchThreshold = 0.3, matchCount = 50 } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: '搜索关键词不能为空' },
        { status: 400 }
      )
    }

    logger.debug({ query, matchThreshold, matchCount }, 'Search API request')

    const supabase = createServerClient()

    // 1. 验证用户身份
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      )
    }

    // 2. 获取用户的 embedding 配置
    const { data: configs, error: configError } = await supabase
      .from('api_configs')
      .select('*')
      .eq('user_id', user.id)
      .order('is_default', { ascending: false })
      .limit(1)

    if (configError) {
      logger.error({ error: configError, userId: user.id }, 'Failed to load API config')
      return NextResponse.json(
        { error: '获取配置失败' },
        { status: 500 }
      )
    }

    const config = configs?.[0]
    if (!config?.embedding_api_key || !config?.embedding_api_base || !config?.embedding_model) {
      return NextResponse.json(
        { error: '未配置 Embedding API，请先在设置中配置' },
        { status: 400 }
      )
    }

    // 3. 解密 API 凭证
    const embeddingApiKey = isEncrypted(config.embedding_api_key)
      ? await decrypt(config.embedding_api_key)
      : config.embedding_api_key

    const embeddingApiBase = isEncrypted(config.embedding_api_base)
      ? await decrypt(config.embedding_api_base)
      : config.embedding_api_base

    // 4. 生成查询 embedding
    const queryEmbedding = await generateEmbedding(query, {
      apiKey: embeddingApiKey,
      apiBase: embeddingApiBase,
      model: config.embedding_model,
      dimensions: config.embedding_dimensions || 1536,
    })

    // 5. 执行语义搜索
    const { data: results, error: searchError } = await supabase.rpc(
      'search_articles_semantic',
      {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: matchCount,
        p_user_id: user.id,
      }
    )

    if (searchError) {
      logger.error({ error: searchError, userId: user.id }, 'Semantic search RPC failed')
      return NextResponse.json(
        { error: '搜索失败' },
        { status: 500 }
      )
    }

    logger.info({ userId: user.id, query, resultCount: results?.length || 0 }, 'Search completed')

    // 6. 转换结果格式
    const formattedResults = (results || []).map((row: any) => ({
      id: row.id,
      feedId: row.feed_id,
      title: row.title,
      content: row.content,
      summary: row.summary,
      url: row.url,
      author: row.author,
      publishedAt: row.published_at,
      isRead: row.is_read,
      isStarred: row.is_starred,
      thumbnail: row.thumbnail,
      similarity: row.similarity,
    }))

    return NextResponse.json({ results: formattedResults })

  } catch (error) {
    logger.error({ error }, 'Search API error')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    )
  }
}
```

## API 规格

### 请求

```
POST /api/search
Content-Type: application/json
```

#### 请求体

```typescript
{
  query: string          // 搜索关键词（必填）
  matchThreshold?: number // 相似度阈值，默认 0.3
  matchCount?: number     // 最大返回数量，默认 50
}
```

### 响应

#### 成功 (200)

```typescript
{
  results: Array<{
    id: string
    feedId: string
    title: string
    content: string
    summary?: string
    url: string
    author?: string
    publishedAt: string   // ISO 日期字符串
    isRead: boolean
    isStarred: boolean
    thumbnail?: string
    similarity: number    // 0-1 之间的相似度分数
  }>
}
```

#### 错误响应

| 状态码 | 错误 | 说明 |
|--------|------|------|
| 400 | `搜索关键词不能为空` | query 参数缺失或为空 |
| 400 | `未配置 Embedding API` | 用户未配置 embedding 相关字段 |
| 401 | `未授权` | 用户未登录 |
| 500 | `获取配置失败` | 数据库查询失败 |
| 500 | `搜索失败` | 向量搜索 RPC 执行失败 |
| 500 | `服务器错误` | 其他未知错误 |

## 使用示例

### 客户端调用

```typescript
async function search(query: string): Promise<SearchResult[]> {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      matchThreshold: 0.3,
      matchCount: 20,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || '搜索失败')
  }

  const data = await response.json()
  return data.results
}
```

### 使用 Store（推荐）

```typescript
import { useStore } from "@/lib/store"

function SearchPage() {
  const { performSemanticSearch, searchResults, isSearching, searchError } = useStore()

  const handleSearch = async (query: string) => {
    await performSemanticSearch(query)
  }

  // searchResults 已经是格式化后的结果
}
```

## 安全考虑

1. **身份验证**: API 要求用户登录
2. **数据隔离**: RPC 函数使用 `p_user_id` 确保只搜索用户自己的数据
3. **凭证解密**: embedding API 凭证在服务端解密，不暴露给客户端
4. **输入验证**: 验证 query 参数非空

## 性能考虑

1. **embedding 缓存**: 考虑对相同查询缓存 embedding（可选优化）
2. **超时设置**: embedding 生成可能较慢，考虑设置超时
3. **并发限制**: 高并发场景下可能需要限流

## 下一步

完成搜索 API 后，继续 [Phase 7: 前端搜索页面](./07-search-page.md)
