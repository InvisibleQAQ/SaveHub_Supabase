# 高级开发任务

本文档提供复杂功能的实现指南,包括 OPML 导入导出、阅读统计和拖拽排序等高级特性。

---

## 任务 1:导出和导入 OPML

**需求**:支持导出订阅源为 OPML 格式,也支持导入 OPML。

### 导出 OPML

1. **创建 OPML 生成函数**(`lib/opml.ts`):

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

2. **创建导出组件**(已在开发指南中展示)。

### 导入 OPML

1. **创建 OPML 解析函数**(`lib/opml.ts`):

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

2. **创建导入组件**(`components/import-opml-dialog.tsx`):

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

      const content = await file.text()
      const feeds = parseOPML(content)

      if (feeds.length === 0) {
        toast.error("没有找到有效的订阅源")
        return
      }

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

## 任务 2:添加文章阅读统计

**需求**:显示每天阅读了多少篇文章。

### 步骤

1. **更新 Article 类型**,添加阅读时间字段(`lib/types.ts`):

```typescript
export const ArticleSchema = z.object({
  // ... 现有字段
  readAt: z.date().optional(),  // 新增:标记已读的时间
})
```

2. **更新数据库**:

```sql
ALTER TABLE articles ADD COLUMN read_at TIMESTAMPTZ;
CREATE INDEX idx_articles_read_at ON articles(read_at);
```

3. **修改 markAsRead action**(`lib/store.ts`):

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

4. **创建统计组件**(`components/reading-stats.tsx`):

```typescript
"use client"

import { useRSSStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ReadingStats() {
  const articles = useRSSStore(state => state.articles)

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

5. **添加新的设置页面以显示统计**:

创建 `app/(reader)/settings/stats/page.tsx`:

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

然后在 `app/(reader)/settings/layout.tsx` 中添加导航项:

```typescript
const settingsCategories = [
  { id: "general", label: "General", href: "/settings/general" },
  { id: "appearance", label: "Appearance", href: "/settings/appearance" },
  { id: "storage", label: "Storage", href: "/settings/storage" },
  { id: "stats", label: "Statistics", href: "/settings/stats" }, // 新增
]
```

---

## 任务 3:实现拖拽排序

**需求**:让 Feed 可以拖拽重组,支持移入/移出 Folder,调整顺序。

### 架构设计

**核心思想**:使用原生 HTML5 Drag/Drop API + `order` 字段存储顺序。

**关键决策**:
- **原生 API vs 第三方库**:选择原生(零依赖,30行代码)
- **排序字段**:`order: number` 存储在数据库
- **单一 action**:`moveFeed(feedId, targetFolderId, targetOrder)` 处理所有场景

### 步骤 1:添加 order 字段

**数据库 Migration**(`scripts/002_add_order_fields.sql`):

```sql
-- 添加 order 字段
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;

-- 初始化现有数据的 order 值(按创建时间)
WITH ordered_feeds AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY folder_id ORDER BY created_at) as row_num
  FROM feeds
)
UPDATE feeds
SET "order" = ordered_feeds.row_num
FROM ordered_feeds
WHERE feeds.id = ordered_feeds.id;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_feeds_folder_order ON feeds(folder_id, "order");
```

在 Supabase Dashboard → SQL Editor 执行此脚本。

### 步骤 2:更新类型和数据库映射

**类型定义**(`lib/types.ts`):

```typescript
export const FeedSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  folderId: z.string().optional(),
  order: z.number().default(0),  // 新增
  // ... 其他字段
})

export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().default(0),  // 新增
  createdAt: z.date().default(() => new Date()),
})
```

**数据库映射**(`lib/db/feeds.ts`):

```typescript
function feedToDb(feed: Feed): DbRow {
  return {
    // ... 其他字段
    order: feed.order,
  }
}

function dbRowToFeed(row: DbRow): Feed {
  return {
    // ... 其他字段
    order: row.order,
  }
}

// 更新排序字段:从 created_at 改为 order
private feedsRepo = new GenericRepository(
  "feeds", feedToDb, dbRowToFeed,
  { column: "order", ascending: true }  // 按 order 排序
)
```

### 步骤 3:添加 Store Actions

**Store**(`lib/store.ts`):

```typescript
interface RSSReaderActions {
  moveFeed: (feedId: string, targetFolderId: string | undefined, targetOrder: number) => void
  moveFolder: (folderId: string, targetOrder: number) => void
}

export const useRSSStore = create<RSSReaderState & RSSReaderActions>()((set, get) => ({
  // ... 现有 state

  moveFeed: (feedId, targetFolderId, targetOrder) => {
    set((state) => {
      const feed = state.feeds.find((f) => f.id === feedId)
      if (!feed) return state

      const oldFolderId = feed.folderId

      // 更新 folderId
      let updatedFeeds = state.feeds.map((f) =>
        f.id === feedId ? { ...f, folderId: targetFolderId } : f
      )

      // 获取目标 folder 内的所有 Feed
      const sameFolderFeeds = updatedFeeds.filter(
        (f) => (f.folderId || undefined) === (targetFolderId || undefined)
      )

      const otherFeeds = updatedFeeds.filter(
        (f) => (f.folderId || undefined) !== (targetFolderId || undefined)
      )

      // 移除被拖动的 Feed,插入到目标位置
      const movedFeed = sameFolderFeeds.find((f) => f.id === feedId)!
      const otherSameFolderFeeds = sameFolderFeeds.filter((f) => f.id !== feedId)
      otherSameFolderFeeds.splice(targetOrder, 0, movedFeed)

      // 重新分配 order
      const reorderedSameFolderFeeds = otherSameFolderFeeds.map((f, index) => ({
        ...f,
        order: index,
      }))

      // 如果跨 folder 移动,也重排源 folder
      if (oldFolderId !== targetFolderId && oldFolderId !== undefined) {
        const oldFolderFeeds = otherFeeds
          .filter((f) => f.folderId === oldFolderId)
          .map((f, index) => ({ ...f, order: index }))

        updatedFeeds = [
          ...reorderedSameFolderFeeds,
          ...oldFolderFeeds,
          ...otherFeeds.filter((f) => f.folderId !== oldFolderId)
        ]
      } else {
        updatedFeeds = [...reorderedSameFolderFeeds, ...otherFeeds]
      }

      return { feeds: updatedFeeds }
    })

    get().syncToSupabase()
  },

  moveFolder: (folderId, targetOrder) => {
    set((state) => {
      const folders = [...state.folders]
      const folderIndex = folders.findIndex((f) => f.id === folderId)
      if (folderIndex === -1) return state

      // 移除并插入到新位置
      const [movedFolder] = folders.splice(folderIndex, 1)
      folders.splice(targetOrder, 0, movedFolder)

      // 重新分配 order
      return {
        folders: folders.map((folder, index) => ({ ...folder, order: index })),
      }
    })

    get().syncToSupabase()
  },
}))
```

### 步骤 4:添加拖拽 Handlers

**FeedItem 组件**(`components/sidebar/feed-item.tsx`):

```typescript
interface FeedItemProps {
  feed: Feed
  // ... 其他 props
  onDragStart?: (feedId: string) => void
  onDragOver?: (e: React.DragEvent, feedId: string) => void
  onDrop?: (e: React.DragEvent, feedId: string) => void
  isDragging?: boolean
}

export function FeedItem({ feed, onDragStart, onDragOver, onDrop, isDragging, ... }: FeedItemProps) {
  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    onDragStart?.(feed.id)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDragOver?.(e, feed.id)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDrop?.(e, feed.id)
  }

  return (
    <div
      className={cn(
        "group relative transition-opacity",
        isDragging && "opacity-50 cursor-move"
      )}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Feed 内容 */}
    </div>
  )
}
```

**FolderItem 组件**(`components/sidebar/folder-item.tsx`):

```typescript
interface FolderItemProps {
  folder: FolderType
  feeds: Feed[]
  // ... 其他 props
  onDragOverFolder?: (e: React.DragEvent, folderId: string) => void
  onDropOnFolder?: (e: React.DragEvent, folderId: string) => void
  onFeedDragStart?: (feedId: string) => void
  onFeedDragOver?: (e: React.DragEvent, feedId: string) => void
  onFeedDrop?: (e: React.DragEvent, feedId: string) => void
  draggedFeedId?: string | null
}

export function FolderItem({ folder, onDragOverFolder, onDropOnFolder, ... }: FolderItemProps) {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDragOverFolder?.(e, folder.id)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDropOnFolder?.(e, folder.id)
  }

  return (
    <div onDragOver={handleDragOver} onDrop={handleDrop}>
      <Collapsible>
        {/* Folder header */}
        <CollapsibleContent>
          {feeds.map((feed) => (
            <FeedItem
              key={feed.id}
              feed={feed}
              onDragStart={onFeedDragStart}
              onDragOver={onFeedDragOver}
              onDrop={onFeedDrop}
              isDragging={draggedFeedId === feed.id}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
```

### 步骤 5:连接拖拽逻辑

**ExpandedView**(`components/sidebar/expanded-view.tsx`):

```typescript
export function ExpandedView() {
  const { feeds, moveFeed } = useRSSStore()
  const [draggedFeedId, setDraggedFeedId] = React.useState<string | null>(null)

  const handleFeedDragStart = (feedId: string) => {
    setDraggedFeedId(feedId)
  }

  const handleFeedDrop = (e: React.DragEvent, targetFeedId: string) => {
    e.preventDefault()
    if (!draggedFeedId || draggedFeedId === targetFeedId) return

    const draggedFeed = feeds.find((f) => f.id === draggedFeedId)
    const targetFeed = feeds.find((f) => f.id === targetFeedId)
    if (!draggedFeed || !targetFeed) return

    // 计算目标位置
    const targetFolderId = targetFeed.folderId
    const sameFolderFeeds = feeds
      .filter((f) => (f.folderId || undefined) === (targetFolderId || undefined))
      .sort((a, b) => a.order - b.order)

    const targetIndex = sameFolderFeeds.findIndex((f) => f.id === targetFeedId)

    moveFeed(draggedFeedId, targetFolderId, targetIndex)
    setDraggedFeedId(null)
  }

  const handleDropOnFolder = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    if (!draggedFeedId) return

    moveFeed(draggedFeedId, folderId, 0)  // 插入到 folder 第一个位置
    setDraggedFeedId(null)
  }

  const handleDropOnRootLevel = (e: React.DragEvent) => {
    e.preventDefault()
    if (!draggedFeedId) return

    const rootLevelFeeds = feeds
      .filter((f) => !f.folderId)
      .sort((a, b) => a.order - b.order)

    moveFeed(draggedFeedId, undefined, rootLevelFeeds.length)  // 添加到根级别末尾
    setDraggedFeedId(null)
  }

  return (
    <div>
      {/* Folders */}
      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          feeds={feedsByFolder[folder.id] || []}
          onDragOverFolder={() => {}}
          onDropOnFolder={handleDropOnFolder}
          onFeedDragStart={handleFeedDragStart}
          onFeedDragOver={() => {}}
          onFeedDrop={handleFeedDrop}
          draggedFeedId={draggedFeedId}
        />
      ))}

      {/* Root Level Drop Zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnRootLevel}
        className={cn(
          "min-h-[60px] rounded-md transition-colors",
          draggedFeedId && "bg-sidebar-accent/30 border-2 border-dashed border-sidebar-border"
        )}
      >
        {feedsByFolder.none?.map((feed) => (
          <FeedItem
            key={feed.id}
            feed={feed}
            onDragStart={handleFeedDragStart}
            onDragOver={() => {}}
            onDrop={handleFeedDrop}
            isDragging={draggedFeedId === feed.id}
          />
        ))}
        {draggedFeedId && (!feedsByFolder.none || feedsByFolder.none.length === 0) && (
          <div className="flex items-center justify-center h-[60px] text-xs text-sidebar-foreground/40">
            Drop here to move to root level
          </div>
        )}
      </div>
    </div>
  )
}
```

### 关键要点

**1. 原生 API 使用**:
```typescript
draggable               // 使元素可拖动
onDragStart            // 记录被拖动的元素
onDragOver + preventDefault  // 允许放置
onDrop + preventDefault      // 处理放置
```

**2. 视觉反馈**:
- 拖动时:`opacity-50 cursor-move`
- Drop zone:`border-dashed` + 提示文字

**3. order 重排**:
- 移除拖动的元素
- 在目标位置插入
- 重新分配连续的 order(0, 1, 2, ...)

**4. 跨 folder 处理**:
- 更新 folderId
- 重排目标 folder 的 order
- 重排源 folder 的 order

**5. 性能优化**:
- `e.stopPropagation()` 防止事件冒泡
- 批量更新数据库(`syncToSupabase` 一次性保存)

---

## 下一步

- 查看 [常见任务](./06-common-tasks.md) 了解基础开发任务
- 查看 [故障排查](./07-troubleshooting.md) 解决开发中的问题
- 参考 [开发指南](./05-development-guide.md) 了解开发模式
