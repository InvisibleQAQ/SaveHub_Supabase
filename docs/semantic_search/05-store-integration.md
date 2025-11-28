# Phase 5: Zustand Store 集成

## 概述

将 embedding 生成集成到现有的 Zustand store 中，实现文章添加时自动生成 embedding。

## 修改文件

### 1. `lib/store/articles.slice.ts`

修改 `addArticles` action，在文章保存后异步生成 embedding。

```typescript
import { generateArticleEmbedding } from "@/lib/embedding"
import { updateArticleEmbedding } from "@/lib/db/articles"
import type { EmbeddingConfig } from "@/lib/types"

export interface ArticlesSlice {
  // 现有接口...
  addArticles: (articles: Article[]) => Promise<number>
}

export const createArticlesSlice: StateCreator<
  RSSReaderState,
  [],
  [],
  ArticlesSlice
> = (set, get) => ({
  addArticles: async (articles) => {
    // ===== 现有逻辑：去重 =====
    const currentState = get()
    const enrichedArticles = await Promise.all(
      articles.map(async (article) => {
        const contentHash = await computeContentHash(article.title, article.content)
        return { ...article, contentHash, embeddingStatus: 'pending' as const }
      })
    )

    const existingUrls = new Set(currentState.articles.map(a => a.url))
    const existingHashes = new Set(
      currentState.articles
        .filter(a => a.contentHash)
        .map(a => a.contentHash)
    )

    const newArticles = enrichedArticles.filter((article) => {
      if (existingUrls.has(article.url)) return false
      const feed = currentState.feeds.find(f => f.id === article.feedId)
      if (feed?.enableDeduplication && article.contentHash && existingHashes.has(article.contentHash)) {
        return false
      }
      return true
    })

    if (newArticles.length === 0) {
      return 0
    }

    // ===== 更新 store =====
    set((state: any) => ({
      articles: [...state.articles, ...newArticles],
    }))

    // ===== 保存到数据库 =====
    dbManager.saveArticles(newArticles).catch((error) => {
      console.error("Failed to save articles to Supabase:", error)
    })

    // ===== 新增：异步生成 embedding（非阻塞）=====
    const embeddingConfig = getEmbeddingConfigFromStore(currentState)
    if (embeddingConfig) {
      // 后台处理，不阻塞文章添加
      processArticleEmbeddings(newArticles, embeddingConfig, set)
    }

    return newArticles.length
  },
})

/**
 * 从 store 状态中获取 embedding 配置
 */
function getEmbeddingConfigFromStore(state: RSSReaderState): EmbeddingConfig | null {
  // 找到默认的 API 配置
  const defaultConfig = state.apiConfigs.find(c => c.isDefault && c.isActive)
    || state.apiConfigs.find(c => c.isActive)

  if (!defaultConfig?.embeddingApiKey || !defaultConfig?.embeddingApiBase || !defaultConfig?.embeddingModel) {
    return null
  }

  return {
    apiKey: defaultConfig.embeddingApiKey,
    apiBase: defaultConfig.embeddingApiBase,
    model: defaultConfig.embeddingModel,
    dimensions: defaultConfig.embeddingDimensions || 1536,
  }
}

/**
 * 后台处理文章 embedding 生成
 */
async function processArticleEmbeddings(
  articles: Article[],
  config: EmbeddingConfig,
  set: any
): Promise<void> {
  for (const article of articles) {
    try {
      const embedding = await generateArticleEmbedding(
        { title: article.title, content: article.content },
        config
      )

      // 更新数据库
      await updateArticleEmbedding(article.id, embedding, 'completed')

      // 更新 store 状态
      set((state: any) => ({
        articles: state.articles.map((a: Article) =>
          a.id === article.id
            ? { ...a, embedding, embeddingStatus: 'completed' }
            : a
        ),
      }))
    } catch (error) {
      console.error(`Failed to generate embedding for article ${article.id}:`, error)

      // 标记为失败
      await updateArticleEmbedding(article.id, null, 'failed')

      set((state: any) => ({
        articles: state.articles.map((a: Article) =>
          a.id === article.id
            ? { ...a, embeddingStatus: 'failed' }
            : a
        ),
      }))
    }

    // 添加小延迟避免 rate limiting
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}
```

### 2. 新建 `lib/store/search.slice.ts`

```typescript
import type { StateCreator } from "zustand"
import type { RSSReaderState, SearchResult, EmbeddingConfig } from "@/lib/types"
import { generateEmbedding } from "@/lib/embedding"
import { semanticSearch } from "@/lib/db/search"
import { logger } from "@/lib/logger"

export interface SearchSlice {
  // 状态
  searchResults: SearchResult[]
  isSearching: boolean
  searchError: string | null
  searchQuery: string

  // Actions
  performSemanticSearch: (query: string) => Promise<void>
  clearSearchResults: () => void
  getEmbeddingConfig: () => EmbeddingConfig | null
}

export const createSearchSlice: StateCreator<
  RSSReaderState,
  [],
  [],
  SearchSlice
> = (set, get) => ({
  // 初始状态
  searchResults: [],
  isSearching: false,
  searchError: null,
  searchQuery: '',

  // 执行语义搜索
  performSemanticSearch: async (query: string) => {
    if (!query.trim()) {
      set({ searchResults: [], searchQuery: '', searchError: null })
      return
    }

    const config = get().getEmbeddingConfig()
    if (!config) {
      set({
        searchError: '未配置 Embedding API，请先在设置中配置',
        isSearching: false,
      })
      return
    }

    set({ isSearching: true, searchError: null, searchQuery: query })

    try {
      logger.debug({ query }, 'Starting semantic search')

      // 1. 生成查询文本的 embedding
      const queryEmbedding = await generateEmbedding(query, config)

      // 2. 执行向量搜索
      const results = await semanticSearch({
        queryEmbedding,
        matchThreshold: 0.3,
        matchCount: 50,
      })

      logger.info({ query, resultCount: results.length }, 'Semantic search completed')

      set({
        searchResults: results,
        isSearching: false,
        searchError: null,
      })
    } catch (error) {
      logger.error({ error, query }, 'Semantic search failed')
      set({
        searchResults: [],
        isSearching: false,
        searchError: error instanceof Error ? error.message : '搜索失败',
      })
    }
  },

  // 清空搜索结果
  clearSearchResults: () => {
    set({
      searchResults: [],
      searchQuery: '',
      searchError: null,
      isSearching: false,
    })
  },

  // 获取 embedding 配置
  getEmbeddingConfig: () => {
    const state = get()
    const defaultConfig = state.apiConfigs.find(c => c.isDefault && c.isActive)
      || state.apiConfigs.find(c => c.isActive)

    if (!defaultConfig?.embeddingApiKey || !defaultConfig?.embeddingApiBase || !defaultConfig?.embeddingModel) {
      return null
    }

    return {
      apiKey: defaultConfig.embeddingApiKey,
      apiBase: defaultConfig.embeddingApiBase,
      model: defaultConfig.embeddingModel,
      dimensions: defaultConfig.embeddingDimensions || 1536,
    }
  },
})
```

### 3. 更新 `lib/store/index.ts`

集成 SearchSlice：

```typescript
import { createSearchSlice, type SearchSlice } from "./search.slice"

// 更新 RSSReaderState 类型
export type RSSReaderState =
  & DatabaseSlice
  & FoldersSlice
  & FeedsSlice
  & ArticlesSlice
  & UISlice
  & SettingsSlice
  & ApiConfigsSlice
  & SearchSlice  // ===== 新增 =====

// 更新 store 创建
export const useStore = create<RSSReaderState>()((...a) => ({
  ...createDatabaseSlice(...a),
  ...createFoldersSlice(...a),
  ...createFeedsSlice(...a),
  ...createArticlesSlice(...a),
  ...createUISlice(...a),
  ...createSettingsSlice(...a),
  ...createApiConfigsSlice(...a),
  ...createSearchSlice(...a),  // ===== 新增 =====
}))
```

## 使用示例

### 在组件中使用搜索

```typescript
import { useStore } from "@/lib/store"

function SearchComponent() {
  const {
    searchResults,
    isSearching,
    searchError,
    searchQuery,
    performSemanticSearch,
    clearSearchResults,
    getEmbeddingConfig,
  } = useStore()

  const hasEmbeddingConfig = !!getEmbeddingConfig()

  const handleSearch = async (query: string) => {
    await performSemanticSearch(query)
  }

  // ...
}
```

### 检查文章的 embedding 状态

```typescript
const articles = useStore(state => state.articles)

// 统计 embedding 状态
const stats = {
  pending: articles.filter(a => a.embeddingStatus === 'pending').length,
  completed: articles.filter(a => a.embeddingStatus === 'completed').length,
  failed: articles.filter(a => a.embeddingStatus === 'failed').length,
}
```

## 数据流

```
用户添加 RSS 源
    ↓
addArticles() 调用
    ↓
去重 → 更新 Store → 保存数据库
    ↓
检查 embedding 配置
    ↓
[有配置] → 后台异步生成 embedding
    ↓
生成成功 → updateArticleEmbedding('completed')
生成失败 → updateArticleEmbedding('failed')
```

## 注意事项

1. **非阻塞**: embedding 生成是异步的，不会阻塞文章添加
2. **错误隔离**: 单篇文章 embedding 失败不影响其他文章
3. **Rate Limiting**: 每篇文章生成后有 200ms 延迟
4. **状态同步**: embedding 状态同时更新到 store 和数据库

## 下一步

完成 Store 集成后，继续 [Phase 6: 搜索 API](./06-search-api.md)
