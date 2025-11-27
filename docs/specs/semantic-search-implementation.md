# Semantic Search Implementation Spec

## 【核心判断】

✅ **值得做**

**原因**：
1. **真实需求**：用户需要在数百篇文章中找到相关内容，传统的全文搜索（LIKE '%keyword%'）只能匹配字面文字，无法理解语义
2. **数据结构清晰**：问题的本质是"给定一个查询向量，找到最相似的 N 个文档向量"，这是个标准的 KNN 问题
3. **破坏性可控**：只需添加新列和索引，不修改现有业务逻辑

---

## 【关键洞察】

### 数据结构分析

"Bad programmers worry about the code. Good programmers worry about data structures."

**核心数据关系**：
```
Article (title, content)
  → Embedding Generator (OpenAI/Local Model)
  → Vector (1536 dimensions for text-embedding-3-small)
  → pgvector Index (IVFFLAT/HNSW)
  → Similarity Search (cosine distance)
```

**关键问题**：
- **谁拥有 embedding？** articles 表，每行一个 vector
- **什么时候生成？** 文章插入时异步生成，不阻塞 UI
- **如何查询？** 用户查询 → 生成查询向量 → pgvector KNN 查询
- **如何处理失败？** embedding 生成失败不影响文章保存，只是搜不到

### 复杂度审查

"如果实现需要超过3层缩进，重新设计它"

**问题本质（一句话）**：
> 把文本变成向量，然后找到最近的 10 个向量。

**当前方案用了多少概念？**
- Database: pgvector extension, vector column, index
- Backend: embedding generation, API route
- Frontend: search page, input, results list
- Background: batch processing for existing articles

**能否更简单？**
- ❌ 不能省略 embedding 生成（这是核心）
- ❌ 不能省略向量索引（否则查询太慢）
- ✅ 可以省略复杂的 UI（就是一个输入框 + 结果列表）
- ✅ 可以省略批量任务（手动运行一次脚本即可）

### 破坏性分析

"Never break userspace"

**现有功能依赖**：
- ✅ 不破坏文章的 CRUD 操作
- ✅ 不破坏现有路由（`/all`, `/unread`, `/starred`, `/feed/[id]`）
- ✅ 不破坏文章过滤逻辑
- ⚠️ 需要确保 embedding 生成失败时，文章仍然能正常保存

**迁移计划**：
1. 添加 `embedding` 列（nullable）
2. 现有文章的 embedding 为 null（逐步生成）
3. 新文章插入时触发 embedding 生成（异步，不阻塞）

### 实用性验证

"Theory and practice sometimes clash. Theory loses. Every single time."

**真实场景**：
- 用户订阅了 50 个 feed，每天产生 100+ 篇文章
- 用户记得"上周看到一篇关于 Rust 异步编程的文章"，但不记得具体标题
- 全文搜索需要精确关键词，语义搜索可以用"async Rust performance"找到相关文章

**复杂度 vs 收益**：
- 复杂度：中等（需要 embedding API + pgvector）
- 收益：高（显著提升搜索体验）
- ✅ 匹配度合理

---

## 【Linus式方案】

### Phase 1: Database Schema（简单粗暴，先让数据结构正确）

#### 1.1 Enable pgvector Extension

```sql
-- File: scripts/002_enable_pgvector.sql
-- Run this in Supabase SQL editor

CREATE EXTENSION IF NOT EXISTS vector;
```

#### 1.2 Add Embedding Column

```sql
-- File: scripts/003_add_embedding_column.sql
-- vector(1536) is for OpenAI text-embedding-3-small
-- If you use other models, adjust dimensions (e.g., 768 for MiniLM)

ALTER TABLE articles
ADD COLUMN embedding vector(1536);

-- Create index for fast similarity search
-- HNSW is better than IVFFLAT for accuracy, but slower to build
CREATE INDEX articles_embedding_idx
ON articles
USING hnsw (embedding vector_cosine_ops);

-- Alternative: IVFFLAT (faster to build, less accurate)
-- CREATE INDEX articles_embedding_idx
-- ON articles
-- USING ivfflat (embedding vector_cosine_ops)
-- WITH (lists = 100);
```

**为什么这样设计？**
- `embedding` 列是 nullable：现有文章不需要立即生成 embedding
- `vector(1536)`：OpenAI text-embedding-3-small 的维度，如果换模型，只需改这个数字
- `HNSW` 索引：精度高，适合小规模数据（<100万行）；如果数据量大，换 IVFFLAT
- `vector_cosine_ops`：余弦距离，最常用的相似度度量

---

### Phase 2: Embedding Generation（核心是异步，不阻塞用户）

#### 2.1 Embedding Service

```typescript
// File: lib/embedding.ts
// Simple, stupid, works

import { logger } from '@/lib/logger'

export interface EmbeddingConfig {
  apiKey: string
  apiBase: string
  model: string
}

/**
 * Generate embedding for text
 * Returns null on failure (don't crash the app just because embedding failed)
 */
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig
): Promise<number[] | null> {
  try {
    const response = await fetch(`${config.apiBase}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: text,
      }),
    })

    if (!response.ok) {
      logger.error(
        { status: response.status, statusText: response.statusText },
        'Embedding API request failed'
      )
      return null
    }

    const data = await response.json()
    return data.data[0].embedding
  } catch (error) {
    logger.error({ error }, 'Failed to generate embedding')
    return null
  }
}

/**
 * Prepare article text for embedding
 * Simple concatenation: title + content (truncate to 8000 chars to avoid token limits)
 */
export function prepareArticleText(title: string, content: string): string {
  const text = `${title}\n\n${content}`
  return text.slice(0, 8000) // Most embedding models have ~8k token limit
}
```

**为什么这样设计？**
- **返回 null 而不是抛异常**：embedding 失败不应该导致文章保存失败
- **只有两个函数**：一个生成 embedding，一个准备文本。简单到不需要注释。
- **8000 字符截断**：大部分 embedding 模型有 token 限制，粗暴截断比复杂的分块策略更简单

#### 2.2 Database Manager for Embeddings

```typescript
// File: lib/db/embeddings.ts
// CRUD for embeddings

import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'
import { generateEmbedding, prepareArticleText, type EmbeddingConfig } from '@/lib/embedding'

/**
 * Generate and save embedding for an article
 * Called after article is inserted
 */
export async function generateArticleEmbedding(
  articleId: string,
  title: string,
  content: string,
  config: EmbeddingConfig
): Promise<void> {
  const text = prepareArticleText(title, content)
  const embedding = await generateEmbedding(text, config)

  if (!embedding) {
    logger.warn({ articleId }, 'Failed to generate embedding, article will not be searchable')
    return
  }

  const { error } = await supabase
    .from('articles')
    .update({ embedding })
    .eq('id', articleId)

  if (error) {
    logger.error({ error, articleId }, 'Failed to save embedding to database')
  }
}

/**
 * Semantic search using pgvector
 * Returns article IDs ordered by similarity (most similar first)
 */
export async function semanticSearch(
  queryText: string,
  config: EmbeddingConfig,
  limit: number = 10
): Promise<string[]> {
  // Generate embedding for query
  const queryEmbedding = await generateEmbedding(queryText, config)
  if (!queryEmbedding) {
    logger.error('Failed to generate query embedding')
    return []
  }

  // Query using pgvector
  // <=> is cosine distance operator in pgvector
  const { data, error } = await supabase.rpc('semantic_search_articles', {
    query_embedding: queryEmbedding,
    match_count: limit,
  })

  if (error) {
    logger.error({ error }, 'Semantic search query failed')
    return []
  }

  return data.map((row: { id: string }) => row.id)
}

/**
 * Batch generate embeddings for articles without embeddings
 * Run this once after migration
 */
export async function batchGenerateEmbeddings(
  config: EmbeddingConfig,
  batchSize: number = 10
): Promise<{ processed: number; failed: number }> {
  let processed = 0
  let failed = 0

  while (true) {
    // Fetch articles without embeddings
    const { data: articles, error } = await supabase
      .from('articles')
      .select('id, title, content')
      .is('embedding', null)
      .limit(batchSize)

    if (error || !articles || articles.length === 0) {
      break
    }

    // Process batch
    for (const article of articles) {
      try {
        await generateArticleEmbedding(
          article.id,
          article.title,
          article.content || '',
          config
        )
        processed++
      } catch (error) {
        logger.error({ error, articleId: article.id }, 'Batch embedding generation failed')
        failed++
      }
    }

    logger.info({ processed, failed }, 'Batch embedding progress')

    // Rate limiting (if using OpenAI, respect rate limits)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return { processed, failed }
}
```

#### 2.3 Database Function for Semantic Search

```sql
-- File: scripts/004_semantic_search_function.sql
-- PostgreSQL function for semantic search

CREATE OR REPLACE FUNCTION semantic_search_articles(
  query_embedding vector(1536),
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    1 - (embedding <=> query_embedding) as similarity
  FROM articles
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

**为什么用数据库函数？**
- pgvector 的 `<=>` 操作符只能在 SQL 中使用
- 函数可以复用，不用在应用代码里拼 SQL
- Supabase 支持 RPC 调用，代码更清晰

---

### Phase 3: API Routes（薄层，只做转发）

#### 3.1 Search API

```typescript
// File: app/api/search/route.ts
// POST /api/search { query: string }

import { NextRequest, NextResponse } from 'next/server'
import { semanticSearch } from '@/lib/db/embeddings'
import { getDefaultApiConfig } from '@/lib/db/api-configs' // Reuse existing API config
import { decrypt } from '@/lib/encryption'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json()

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
    }

    // Get default API config (embedding model)
    const config = await getDefaultApiConfig()
    if (!config) {
      return NextResponse.json(
        { error: 'No API configuration found. Please configure in Settings > API.' },
        { status: 400 }
      )
    }

    // Decrypt API credentials
    const apiKey = decrypt(config.apiKey)
    const apiBase = decrypt(config.apiBase)

    // Perform semantic search
    const articleIds = await semanticSearch(query, {
      apiKey,
      apiBase,
      model: config.model, // Use embedding model, not chat model
    })

    return NextResponse.json({ articleIds })
  } catch (error) {
    logger.error({ error }, 'Search API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

#### 3.2 Batch Embedding Generation API (Admin Only)

```typescript
// File: app/api/embeddings/batch/route.ts
// POST /api/embeddings/batch

import { NextRequest, NextResponse } from 'next/server'
import { batchGenerateEmbeddings } from '@/lib/db/embeddings'
import { getDefaultApiConfig } from '@/lib/db/api-configs'
import { decrypt } from '@/lib/encryption'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const config = await getDefaultApiConfig()
    if (!config) {
      return NextResponse.json({ error: 'No API configuration' }, { status: 400 })
    }

    const apiKey = decrypt(config.apiKey)
    const apiBase = decrypt(config.apiBase)

    // Start batch processing (async, don't wait)
    batchGenerateEmbeddings({ apiKey, apiBase, model: config.model })
      .then(result => {
        logger.info(result, 'Batch embedding generation completed')
      })
      .catch(error => {
        logger.error({ error }, 'Batch embedding generation failed')
      })

    return NextResponse.json({ message: 'Batch processing started' })
  } catch (error) {
    logger.error({ error }, 'Batch embedding API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

---

### Phase 4: Frontend（一个输入框，一个列表，完事）

#### 4.1 Search Page

```typescript
// File: app/(reader)/search/page.tsx

'use client'

import { useState } from 'react'
import { useRSSStore } from '@/lib/store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ArticleList } from '@/components/article-list'
import { Search } from 'lucide-react'
import { logger } from '@/lib/logger'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const articles = useRSSStore(state => state.articles)

  const handleSearch = async () => {
    if (!query.trim()) return

    setIsSearching(true)
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      if (!response.ok) {
        const error = await response.json()
        logger.error({ error }, 'Search request failed')
        return
      }

      const { articleIds } = await response.json()
      setSearchResults(articleIds)
    } catch (error) {
      logger.error({ error }, 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }

  // Filter articles by search results
  const filteredArticles = searchResults.length > 0
    ? articles.filter(article => searchResults.includes(article.id))
    : []

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
      <div className="p-4 border-b flex gap-2">
        <Input
          placeholder="Semantic search across all articles..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} disabled={isSearching}>
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {searchResults.length > 0 ? (
          <ArticleList articles={filteredArticles} />
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            {isSearching ? 'Searching...' : 'Enter a query to search'}
          </div>
        )}
      </div>
    </div>
  )
}
```

#### 4.2 Add Search to Sidebar

```typescript
// File: components/sidebar/expanded-view.tsx
// Add search button to sidebar navigation

import { Search } from 'lucide-react'
import Link from 'next/link'

// In the navigation section, add:
<Link
  href="/search"
  className="flex items-center gap-2 px-3 py-2 hover:bg-accent rounded-md"
>
  <Search className="h-4 w-4" />
  <span>Search</span>
</Link>
```

---

### Phase 5: Integration（让 embedding 自动生成）

#### 5.1 Trigger Embedding Generation on Article Insert

```typescript
// File: lib/store/articles.slice.ts
// Modify addArticles action

import { generateArticleEmbedding } from '@/lib/db/embeddings'
import { getDefaultApiConfig } from '@/lib/db/api-configs'
import { decrypt } from '@/lib/encryption'

// In addArticles action, after syncArticlesToSupabase:
export const addArticles = async (articles: Article[]) => {
  // ... existing logic to add articles to store and DB ...

  // Generate embeddings asynchronously (don't block UI)
  const config = await getDefaultApiConfig()
  if (config) {
    const apiKey = decrypt(config.apiKey)
    const apiBase = decrypt(config.apiBase)

    for (const article of articles) {
      generateArticleEmbedding(
        article.id,
        article.title,
        article.content || '',
        { apiKey, apiBase, model: config.model }
      ).catch(error => {
        logger.error({ error, articleId: article.id }, 'Failed to generate embedding')
      })
    }
  }
}
```

---

## 【实施步骤】

### Step 1: Database Migration (5 minutes)
1. Run `scripts/002_enable_pgvector.sql` in Supabase SQL editor
2. Run `scripts/003_add_embedding_column.sql`
3. Run `scripts/004_semantic_search_function.sql`

### Step 2: Backend Implementation (30 minutes)
1. Create `lib/embedding.ts`
2. Create `lib/db/embeddings.ts`
3. Create `app/api/search/route.ts`
4. Create `app/api/embeddings/batch/route.ts`

### Step 3: Frontend Implementation (20 minutes)
1. Create `app/(reader)/search/page.tsx`
2. Update `components/sidebar/expanded-view.tsx` to add search link

### Step 4: Integration (10 minutes)
1. Modify `lib/store/articles.slice.ts` to trigger embedding generation

### Step 5: Batch Processing (One-time, run manually)
1. Call `POST /api/embeddings/batch` to generate embeddings for existing articles
2. Monitor logs to track progress

---

## 【关键设计决策】

### 1. Why Async Embedding Generation?
**Problem**: Generating embeddings takes 100-500ms per article. If we wait for embeddings before showing articles to user, UX is terrible.

**Solution**:
- Insert article → Show to user immediately
- Generate embedding in background
- If embedding fails, article is still readable (just not searchable)

**Trade-off**: New articles won't appear in search results immediately (takes a few seconds). Acceptable because users rarely search for just-added articles.

### 2. Why Reuse api_configs Table?
**Problem**: We need API credentials to call embedding API.

**Solution**: Reuse existing `api_configs` table (already encrypted, already has UI).

**Trade-off**: User must configure API before search works. But they probably already did this for other AI features.

### 3. Why HNSW Index?
**Problem**: IVFFLAT is faster to build but less accurate. HNSW is slower to build but more accurate.

**Solution**: Use HNSW by default (for <100k articles, build time is <1 minute).

**Trade-off**: If user has >100k articles, switch to IVFFLAT with `lists = 100`.

### 4. Why Truncate to 8000 Characters?
**Problem**: Embedding models have token limits (~8k tokens).

**Solution**: Truncate to 8000 characters (roughly 2000 tokens in English, safe margin).

**Trade-off**: Very long articles lose tail content in embeddings. But title + first 8000 chars captures the essence.

---

## 【测试计划】

### Unit Tests
1. `generateEmbedding()` returns null on API failure
2. `prepareArticleText()` truncates correctly
3. `semanticSearch()` returns empty array on error

### Integration Tests
1. Add article → embedding generated in background
2. Search for "async programming" → returns relevant articles
3. API config missing → search returns error message

### Performance Tests
1. Search latency: <500ms for 10k articles
2. Index build time: <1 minute for 10k articles
3. Batch processing: ~100 articles/minute (with rate limiting)

---

## 【可能的问题】

### Problem: Embedding API Rate Limits
**Symptom**: Batch processing fails with 429 errors.

**Solution**: Increase delay in `batchGenerateEmbeddings()` (change 1000ms to 2000ms).

### Problem: Search Returns Irrelevant Results
**Symptom**: Query "Rust async" returns articles about JavaScript.

**Solution**:
1. Check embedding model (text-embedding-3-small is good, ada-002 is worse)
2. Check if article content is too short (need at least 50 words)
3. Try reranking with title match as tiebreaker

### Problem: Index Build Takes Too Long
**Symptom**: Adding embedding column takes >5 minutes.

**Solution**: Switch from HNSW to IVFFLAT:
```sql
CREATE INDEX articles_embedding_idx
ON articles
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

---

## 【后续优化】（不在 MVP 范围内）

1. **Incremental Indexing**: Use Supabase triggers to auto-generate embeddings on INSERT
2. **Hybrid Search**: Combine semantic search with full-text search (BM25)
3. **Reranking**: Use cross-encoder to rerank top 100 results
4. **Caching**: Cache query embeddings for common searches
5. **Multi-language**: Use multilingual embedding models (e.g., text-embedding-3-large)

---

## 【总结】

这个方案的核心是：
1. **数据结构简单**：一个 vector 列 + 一个索引
2. **代码简单**：两个函数生成 embedding，一个函数搜索
3. **不破坏现有功能**：embedding 是可选的，失败不影响文章保存
4. **实用**：用户能用"模糊记忆"找到文章，而不是精确关键词

"Talk is cheap. Show me the code."
现在去写这些文件，一个一个来，别想着一次性搞定所有东西。先让数据库跑起来，再让 API 跑起来，最后加 UI。

每一步都测试，确保能 work，再进行下一步。
