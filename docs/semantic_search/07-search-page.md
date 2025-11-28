# Phase 7: 前端搜索页面

## 概述

创建 `/search` 路由页面，提供语义搜索界面。

## 新建文件

### 1. `hooks/use-debounce.ts`

```typescript
import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}
```

### 2. `app/(reader)/search/page.tsx`

```typescript
"use client"

import { SearchArticleList } from "@/components/search-article-list"
import { ArticleContent } from "@/components/article-content"

export default function SearchPage() {
  return (
    <>
      <div className="w-96 flex-shrink-0 border-r border-border bg-card">
        <SearchArticleList />
      </div>
      <div className="flex-1 bg-background">
        <ArticleContent />
      </div>
    </>
  )
}
```

### 3. `components/search-article-list.tsx`

```typescript
"use client"

import { useState, useEffect } from "react"
import { useStore } from "@/lib/store"
import { useDebounce } from "@/hooks/use-debounce"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  Search,
  Loader2,
  AlertCircle,
  Settings,
  Sparkles,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import Link from "next/link"
import { cn } from "@/lib/utils"

export function SearchArticleList() {
  const [inputValue, setInputValue] = useState("")
  const debouncedQuery = useDebounce(inputValue, 300)

  const {
    searchResults,
    isSearching,
    searchError,
    searchQuery,
    performSemanticSearch,
    clearSearchResults,
    getEmbeddingConfig,
    selectedArticleId,
    setSelectedArticle,
    feeds,
  } = useStore()

  const hasEmbeddingConfig = !!getEmbeddingConfig()

  // 当 debounced query 变化时执行搜索
  useEffect(() => {
    if (debouncedQuery.trim()) {
      performSemanticSearch(debouncedQuery)
    } else {
      clearSearchResults()
    }
  }, [debouncedQuery, performSemanticSearch, clearSearchResults])

  // 获取 feed 名称
  const getFeedName = (feedId: string) => {
    return feeds.find(f => f.id === feedId)?.title || "Unknown Feed"
  }

  // 格式化相似度分数
  const formatSimilarity = (similarity: number) => {
    return `${Math.round(similarity * 100)}%`
  }

  // 获取相似度颜色
  const getSimilarityColor = (similarity: number) => {
    if (similarity >= 0.8) return "bg-green-500"
    if (similarity >= 0.6) return "bg-yellow-500"
    return "bg-orange-500"
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">语义搜索</h2>
        </div>
      </div>

      {/* Search Input */}
      <div className="border-b border-border p-4">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="输入搜索内容..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="pl-9"
            disabled={!hasEmbeddingConfig}
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Content Area */}
      <ScrollArea className="flex-1">
        {/* 未配置 Embedding API */}
        {!hasEmbeddingConfig && (
          <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                需要配置 Embedding API 才能使用语义搜索
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/api">
                  <Settings className="mr-2 h-4 w-4" />
                  前往配置
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* 搜索错误 */}
        {searchError && (
          <div className="flex items-center gap-2 p-4 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{searchError}</span>
          </div>
        )}

        {/* 空状态 - 初始 */}
        {hasEmbeddingConfig && !searchQuery && !isSearching && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <Search className="h-12 w-12" />
            <p className="text-sm">输入关键词开始搜索</p>
            <p className="text-xs">支持自然语言，如：&quot;关于人工智能的文章&quot;</p>
          </div>
        )}

        {/* 空状态 - 无结果 */}
        {hasEmbeddingConfig && searchQuery && !isSearching && searchResults.length === 0 && !searchError && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <Search className="h-12 w-12" />
            <p className="text-sm">未找到相关文章</p>
            <p className="text-xs">尝试使用不同的关键词</p>
          </div>
        )}

        {/* 搜索结果列表 */}
        {searchResults.length > 0 && (
          <div className="divide-y divide-border">
            {/* 结果统计 */}
            <div className="px-4 py-2 text-xs text-muted-foreground">
              找到 {searchResults.length} 条相关结果
            </div>

            {/* 结果项 */}
            {searchResults.map((result) => (
              <button
                key={result.id}
                onClick={() => setSelectedArticle(result.id)}
                className={cn(
                  "w-full p-4 text-left transition-colors hover:bg-accent",
                  selectedArticleId === result.id && "bg-accent"
                )}
              >
                {/* 标题行 */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 font-medium leading-tight">
                    {result.title}
                  </h3>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "shrink-0 text-white",
                      getSimilarityColor(result.similarity)
                    )}
                  >
                    {formatSimilarity(result.similarity)}
                  </Badge>
                </div>

                {/* 摘要 */}
                {result.summary && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {result.summary}
                  </p>
                )}

                {/* 元信息 */}
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-xs">
                    {getFeedName(result.feedId)}
                  </Badge>
                  <span>
                    {formatDistanceToNow(new Date(result.publishedAt), {
                      addSuffix: true,
                      locale: zhCN,
                    })}
                  </span>
                  {result.isRead && (
                    <span className="text-muted-foreground/50">已读</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
```

## 功能说明

### 搜索交互

1. 用户在输入框输入搜索内容
2. 300ms debounce 后自动触发搜索
3. 显示加载状态
4. 展示搜索结果列表

### 状态处理

| 状态 | 显示内容 |
|------|---------|
| 未配置 API | 提示配置，链接到设置页 |
| 初始状态 | 搜索提示 |
| 加载中 | 显示加载动画 |
| 有结果 | 结果列表 + 统计 |
| 无结果 | 无结果提示 |
| 错误 | 错误信息 |

### 结果展示

每个搜索结果显示：
- 文章标题
- 相似度分数（颜色编码）
- 摘要（如有）
- Feed 来源
- 发布时间
- 已读状态

### 相似度颜色

| 分数范围 | 颜色 | 含义 |
|---------|------|------|
| ≥ 80% | 绿色 | 高度相关 |
| ≥ 60% | 黄色 | 中度相关 |
| < 60% | 橙色 | 低度相关 |

## 样式说明

- 使用 `ArticlePageLayout` 的左右分栏布局
- 左侧搜索列表固定宽度 `w-96`
- 右侧文章内容自适应 `flex-1`
- 搜索结果可点击，选中后在右侧显示文章详情

## 键盘快捷键（可选扩展）

如需添加键盘快捷键支持，可以在 `keyboard-shortcuts.tsx` 中添加：

```typescript
// 按 / 聚焦搜索框
case "/":
  if (pathname === "/search") {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('input[placeholder*="搜索"]')?.focus()
  }
  break

// 按 Escape 清空搜索
case "Escape":
  if (pathname === "/search") {
    clearSearchResults()
  }
  break
```

## 下一步

完成搜索页面后，继续 [Phase 8: 设置 UI 更新](./08-settings-ui.md)
