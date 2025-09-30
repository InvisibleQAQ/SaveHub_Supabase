# 常见开发任务

本文档提供具体的代码示例，帮助你快速完成常见开发任务。

---

## 任务 1：添加新的应用设置

**需求**：添加"显示阅读进度条"设置。

### 步骤

1. **更新设置类型**（`lib/db.ts`）：

```typescript
export interface AppSettings {
  id: string
  theme: "light" | "dark" | "system"
  fontSize: number
  autoRefresh: boolean
  refreshInterval: number
  articlesRetentionDays: number
  markAsReadOnScroll: boolean
  showThumbnails: boolean
  showReadingProgress: boolean  // 新增
}

export const defaultSettings: AppSettings = {
  id: "app-settings",
  theme: "system",
  fontSize: 16,
  autoRefresh: true,
  refreshInterval: 30,
  articlesRetentionDays: 30,
  markAsReadOnScroll: false,
  showThumbnails: true,
  showReadingProgress: true,  // 新增
}
```

2. **更新数据库映射**（`lib/db.ts`）：

```typescript
function dbRowToSettings(row: Database["public"]["Tables"]["settings"]["Row"]): AppSettings {
  return {
    id: row.id,
    theme: row.theme as "light" | "dark" | "system",
    fontSize: row.font_size,
    autoRefresh: row.auto_refresh,
    refreshInterval: row.refresh_interval,
    articlesRetentionDays: row.articles_retention_days,
    markAsReadOnScroll: row.mark_as_read_on_scroll,
    showThumbnails: row.show_thumbnails,
    showReadingProgress: row.show_reading_progress,  // 新增
  }
}

async saveSettings(settings: AppSettings): Promise<void> {
  const dbSettings = {
    id: settings.id,
    theme: settings.theme,
    font_size: settings.fontSize,
    auto_refresh: settings.autoRefresh,
    refresh_interval: settings.refreshInterval,
    articles_retention_days: settings.articlesRetentionDays,
    mark_as_read_on_scroll: settings.markAsReadOnScroll,
    show_thumbnails: settings.showThumbnails,
    show_reading_progress: settings.showReadingProgress,  // 新增
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from("settings").upsert(dbSettings)
  if (error) throw error
}
```

3. **更新数据库 Schema**：

在 Supabase SQL Editor 运行：

```sql
ALTER TABLE settings ADD COLUMN show_reading_progress BOOLEAN NOT NULL DEFAULT TRUE;
```

同时更新 `scripts/001_create_tables.sql`：

```sql
CREATE TABLE IF NOT EXISTS settings (
  -- ... 现有字段
  show_reading_progress BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

4. **在设置页面中添加 UI**（`app/(reader)/settings/appearance/page.tsx`）：

```typescript
export default function AppearanceSettingsPage() {
  const { settings, updateSettings } = useRSSStore()

  return (
    <div className="space-y-6">
      {/* ... 其他设置 */}

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="reading-progress">显示阅读进度条</Label>
          <p className="text-sm text-muted-foreground">在文章顶部显示阅读进度</p>
        </div>
        <Switch
          id="reading-progress"
          checked={settings.showReadingProgress}
          onCheckedChange={(checked) =>
            updateSettings({ showReadingProgress: checked })
          }
        />
      </div>
    </div>
  )
}
```

5. **在文章内容组件中使用**（`components/article-content.tsx`）：

```typescript
export function ArticleContent() {
  const settings = useRSSStore(state => state.settings)
  const [scrollProgress, setScrollProgress] = useState(0)

  useEffect(() => {
    if (!settings.showReadingProgress) return

    const handleScroll = () => {
      const element = document.getElementById('article-content')
      if (!element) return

      const { scrollTop, scrollHeight, clientHeight } = element
      const progress = (scrollTop / (scrollHeight - clientHeight)) * 100
      setScrollProgress(progress)
    }

    const element = document.getElementById('article-content')
    element?.addEventListener('scroll', handleScroll)
    return () => element?.removeEventListener('scroll', handleScroll)
  }, [settings.showReadingProgress])

  return (
    <div className="relative">
      {settings.showReadingProgress && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-primary/20">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${scrollProgress}%` }}
          />
        </div>
      )}

      <div id="article-content" className="overflow-y-auto">
        {/* 文章内容 */}
      </div>
    </div>
  )
}
```

---

## 任务 2：支持文章标签（Tags）

**需求**：让用户可以给文章打标签。

### 步骤

1. **更新 Article 类型**（`lib/types.ts`）：

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
  tags: z.array(z.string()).default([]),  // 新增
})
```

2. **更新数据库**：

```sql
ALTER TABLE articles ADD COLUMN tags TEXT[] DEFAULT '{}';
```

3. **更新数据库映射**（`lib/db.ts`）：

```typescript
function dbRowToArticle(row: Database["public"]["Tables"]["articles"]["Row"]): Article {
  return {
    // ... 现有字段
    tags: row.tags || [],  // 新增
  }
}

async saveArticles(articles: Article[]): Promise<void> {
  const dbArticles = articles.map((article) => ({
    // ... 现有字段
    tags: article.tags,  // 新增
  }))

  const { error } = await supabase.from("articles").upsert(dbArticles)
  if (error) throw error
}
```

4. **添加 Store Action**（`lib/store.ts`）：

```typescript
interface RSSReaderActions {
  // ... 现有 actions
  addTagToArticle: (articleId: string, tag: string) => void
  removeTagFromArticle: (articleId: string, tag: string) => void
}

export const useRSSStore = create<RSSReaderState & RSSReaderActions>()(
  persist(
    (set, get) => ({
      // ... 现有 state 和 actions

      addTagToArticle: (articleId, tag) => {
        set(state => ({
          articles: state.articles.map(a =>
            a.id === articleId
              ? { ...a, tags: [...new Set([...a.tags, tag])] }  // 去重
              : a
          )
        }))

        // 更新数据库
        const article = get().articles.find(a => a.id === articleId)
        if (article) {
          dbManager.updateArticle(articleId, { tags: article.tags }).catch(console.error)
        }
      },

      removeTagFromArticle: (articleId, tag) => {
        set(state => ({
          articles: state.articles.map(a =>
            a.id === articleId
              ? { ...a, tags: a.tags.filter(t => t !== tag) }
              : a
          )
        }))

        const article = get().articles.find(a => a.id === articleId)
        if (article) {
          dbManager.updateArticle(articleId, { tags: article.tags }).catch(console.error)
        }
      },
    }),
    { /* ... */ }
  )
)
```

5. **创建标签输入组件**（`components/article-tags.tsx`）：

```typescript
"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import { useRSSStore } from "@/lib/store"

interface ArticleTagsProps {
  articleId: string
}

export function ArticleTags({ articleId }: ArticleTagsProps) {
  const [newTag, setNewTag] = useState("")
  const article = useRSSStore(state => state.articles.find(a => a.id === articleId))
  const addTagToArticle = useRSSStore(state => state.addTagToArticle)
  const removeTagFromArticle = useRSSStore(state => state.removeTagFromArticle)

  if (!article) return null

  const handleAddTag = () => {
    if (newTag.trim()) {
      addTagToArticle(articleId, newTag.trim())
      setNewTag("")
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {article.tags.map(tag => (
          <Badge key={tag} variant="secondary">
            {tag}
            <button
              className="ml-1 hover:text-destructive"
              onClick={() => removeTagFromArticle(articleId, tag)}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="添加标签..."
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
        />
        <Button size="sm" onClick={handleAddTag}>添加</Button>
      </div>
    </div>
  )
}
```

6. **在文章详情中显示**（`components/article-content.tsx`）：

```typescript
import { ArticleTags } from "./article-tags"

export function ArticleContent() {
  const selectedArticleId = useRSSStore(state => state.selectedArticleId)

  if (!selectedArticleId) return null

  return (
    <div>
      {/* 文章内容 */}

      <div className="mt-4 border-t pt-4">
        <h4 className="text-sm font-medium mb-2">标签</h4>
        <ArticleTags articleId={selectedArticleId} />
      </div>
    </div>
  )
}
```

---

## 任务 3：添加键盘快捷键

**需求**：按 `d` 键删除当前文章。

### 步骤

1. **在键盘快捷键组件中添加**（`components/keyboard-shortcuts.tsx`）：

```typescript
export function KeyboardShortcuts() {
  const selectedArticleId = useRSSStore(state => state.selectedArticleId)
  const selectedFeedId = useRSSStore(state => state.selectedFeedId)
  const removeFeed = useRSSStore(state => state.removeFeed)
  const articles = useRSSStore(state => state.articles)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框内的按键
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // ... 现有快捷键

      // 新增：删除当前文章的 Feed
      if (e.key === "d") {
        if (!selectedArticleId) return

        const article = articles.find(a => a.id === selectedArticleId)
        if (!article) return

        if (confirm(`确定要删除订阅源"${article.feedId}"吗？这会删除所有相关文章。`)) {
          removeFeed(article.feedId)
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [selectedArticleId, selectedFeedId, articles, removeFeed])

  return null
}
```

2. **显示快捷键帮助**：

在 `components/help-dialog.tsx` 中添加：

```typescript
export function HelpDialog() {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>键盘快捷键</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        {/* ... 现有快捷键 */}
        <div className="flex justify-between">
          <kbd>d</kbd>
          <span>删除当前文章的订阅源</span>
        </div>
      </div>
    </DialogContent>
  )
}
```

---

## 任务 4：实现文章搜索

**需求**：在文章列表顶部添加搜索框。

### 步骤

1. **Store 已经支持搜索**（`lib/store.ts`）：

检查 `setSearchQuery` action 和 `getFilteredArticles` 中的搜索逻辑已存在。

2. **在文章列表顶部添加搜索框**（`components/article-list.tsx`）：

```typescript
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"

export function ArticleList() {
  const searchQuery = useRSSStore(state => state.searchQuery)
  const setSearchQuery = useRSSStore(state => state.setSearchQuery)
  const filteredArticles = useRSSStore(state => state.getFilteredArticles())

  return (
    <div className="flex flex-col h-full">
      {/* 搜索框 */}
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索文章..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* 文章列表 */}
      <div className="flex-1 overflow-y-auto">
        {filteredArticles.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            {searchQuery ? "没有找到匹配的文章" : "没有文章"}
          </div>
        ) : (
          filteredArticles.map(article => (
            <ArticleItem key={article.id} article={article} />
          ))
        )}
      </div>
    </div>
  )
}
```

3. **高亮搜索关键词**（可选）：

```typescript
function highlightText(text: string, query: string) {
  if (!query) return text

  const parts = text.split(new RegExp(`(${query})`, "gi"))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200">{part}</mark>
    ) : (
      part
    )
  )
}

function ArticleItem({ article }: { article: Article }) {
  const searchQuery = useRSSStore(state => state.searchQuery)

  return (
    <div>
      <h3>{highlightText(article.title, searchQuery)}</h3>
    </div>
  )
}
```

---

## 任务 5：导出和导入 OPML

**需求**：支持导出订阅源为 OPML 格式，也支持导入 OPML。

### 导出 OPML

1. **创建 OPML 生成函数**（`lib/opml.ts`）：

```typescript
import type { Feed } from "./types"

export function generateOPML(feeds: Feed[]): string {
  const feedsXML = feeds
    .map(
      (feed) => `
    <outline
      type="rss"
      text="${escapeXML(feed.title)}"
      title="${escapeXML(feed.title)}"
      xmlUrl="${escapeXML(feed.url)}"
      htmlUrl="${escapeXML(feed.url)}"
    />`
    )
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Feeds</title>
  </head>
  <body>
${feedsXML}
  </body>
</opml>`
}

function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
```

2. **创建导出组件**（已在开发指南中展示）。

### 导入 OPML

1. **创建 OPML 解析函数**（`lib/opml.ts`）：

```typescript
export function parseOPML(opmlContent: string): { title: string; url: string }[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(opmlContent, "text/xml")

  const outlines = doc.querySelectorAll('outline[type="rss"]')
  const feeds: { title: string; url: string }[] = []

  outlines.forEach((outline) => {
    const title = outline.getAttribute("title") || outline.getAttribute("text")
    const url = outline.getAttribute("xmlUrl")

    if (title && url) {
      feeds.push({ title, url })
    }
  })

  return feeds
}
```

2. **创建导入组件**（`components/import-opml-dialog.tsx`）：

```typescript
"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useRSSStore } from "@/lib/store"
import { parseOPML } from "@/lib/opml"
import { parseRSSFeed } from "@/lib/rss-parser"
import { toast } from "sonner"

interface ImportOPMLDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportOPMLDialog({ open, onOpenChange }: ImportOPMLDialogProps) {
  const [isImporting, setIsImporting] = useState(false)
  const addFeed = useRSSStore(state => state.addFeed)
  const addArticles = useRSSStore(state => state.addArticles)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setIsImporting(true)

      // 读取文件
      const content = await file.text()
      const feeds = parseOPML(content)

      if (feeds.length === 0) {
        toast.error("没有找到有效的订阅源")
        return
      }

      // 逐个添加 Feed
      let successCount = 0
      for (const feed of feeds) {
        try {
          const { feed: parsedFeed, articles } = await parseRSSFeed(feed.url, crypto.randomUUID())
          addFeed(parsedFeed)
          addArticles(articles)
          successCount++
        } catch (error) {
          console.error(`Failed to import ${feed.title}:`, error)
        }
      }

      toast.success(`成功导入 ${successCount}/${feeds.length} 个订阅源`)
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to import OPML:", error)
      toast.error("导入失败")
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入 OPML</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <input
            type="file"
            accept=".opml,.xml"
            onChange={handleImport}
            disabled={isImporting}
          />
        </div>

        {isImporting && <p className="text-sm text-muted-foreground">正在导入...</p>}
      </DialogContent>
    </Dialog>
  )
}
```

---

## 任务 6：添加文章阅读统计

**需求**：显示每天阅读了多少篇文章。

### 步骤

1. **更新 Article 类型**，添加阅读时间字段（`lib/types.ts`）：

```typescript
export const ArticleSchema = z.object({
  // ... 现有字段
  readAt: z.date().optional(),  // 新增：标记已读的时间
})
```

2. **更新数据库**：

```sql
ALTER TABLE articles ADD COLUMN read_at TIMESTAMPTZ;
CREATE INDEX idx_articles_read_at ON articles(read_at);
```

3. **修改 markAsRead action**（`lib/store.ts`）：

```typescript
markAsRead: (articleId) => {
  const now = new Date()

  set((state) => ({
    articles: state.articles.map((a) =>
      a.id === articleId
        ? { ...a, isRead: true, readAt: now }  // 记录阅读时间
        : a
    ),
  }))

  dbManager.updateArticle(articleId, { isRead: true, readAt: now }).catch(console.error)
},
```

4. **创建统计组件**（`components/reading-stats.tsx`）：

```typescript
"use client"

import { useRSSStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ReadingStats() {
  const articles = useRSSStore(state => state.articles)

  // 计算最近 7 天每天的阅读量
  const stats = Array.from({ length: 7 }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - i)
    date.setHours(0, 0, 0, 0)

    const nextDate = new Date(date)
    nextDate.setDate(nextDate.getDate() + 1)

    const count = articles.filter(a =>
      a.readAt &&
      a.readAt >= date &&
      a.readAt < nextDate
    ).length

    return {
      date: date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }),
      count,
    }
  }).reverse()

  const totalRead = articles.filter(a => a.isRead).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>阅读统计</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold mb-4">总共阅读 {totalRead} 篇</p>

        <div className="space-y-2">
          {stats.map(({ date, count }) => (
            <div key={date} className="flex items-center gap-2">
              <span className="text-sm w-20">{date}</span>
              <div className="flex-1 bg-secondary h-6 rounded">
                <div
                  className="bg-primary h-full rounded transition-all"
                  style={{ width: `${(count / Math.max(...stats.map(s => s.count))) * 100}%` }}
                />
              </div>
              <span className="text-sm w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
```

5. **添加新的设置页面以显示统计**：

创建 `app/(reader)/settings/stats/page.tsx`：

```typescript
import { ReadingStats } from "@/components/reading-stats"

export default function StatsSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Statistics</h1>
        <p className="text-muted-foreground mt-2">View your reading statistics</p>
      </div>

      <ReadingStats />
    </div>
  )
}
```

然后在 `app/(reader)/settings/layout.tsx` 中添加导航项：

```typescript
const settingsCategories = [
  { id: "general", label: "General", href: "/settings/general" },
  { id: "appearance", label: "Appearance", href: "/settings/appearance" },
  { id: "storage", label: "Storage", href: "/settings/storage" },
  { id: "stats", label: "Statistics", href: "/settings/stats" }, // 新增
]
```

---

## 下一步

- 查看 [故障排查](./07-troubleshooting.md) 解决开发中的问题
- 参考 [开发指南](./05-development-guide.md) 了解开发模式