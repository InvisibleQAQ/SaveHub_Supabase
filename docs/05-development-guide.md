# 开发指南

## 开发环境设置

### 推荐工具

- **VSCode** + 以下扩展：
  - Tailwind CSS IntelliSense
  - ES7+ React/Redux/React-Native snippets
  - Prettier - Code formatter
  - Error Lens（显示行内错误）

- **浏览器开发工具**：
  - Chrome DevTools
  - React Developer Tools（调试组件状态）
  - Zustand DevTools（可选，调试 store）

### 代码风格

遵循 Next.js + TypeScript 规范：
- 使用函数式组件（不用 class）
- 优先用 TypeScript 类型推断，避免手写类型
- 组件用 `PascalCase`，文件名用 `kebab-case`
- 导出默认组件用 `export default`，工具函数用 `export`

---

## 开发工作流

### 日常开发流程

```bash
# 1. 启动开发服务器
pnpm dev

# 2. 修改代码，浏览器自动刷新

# 3. 提交前检查
pnpm lint        # 检查代码规范
pnpm build       # 确保能构建成功
```

### Git 提交规范（建议）

```bash
# 功能
git commit -m "feat: 添加文章搜索功能"

# 修复
git commit -m "fix: 修复文章收藏状态不同步"

# 重构
git commit -m "refactor: 优化 RSS 解析逻辑"

# 文档
git commit -m "docs: 更新开发文档"
```

---

## 核心开发模式

### 模式 1：添加新的 UI 组件

**场景**：我要添加一个"导出 OPML"对话框。

**步骤**：

1. **创建组件文件**：`components/export-opml-dialog.tsx`

```typescript
"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useRSSStore } from "@/lib/store"

interface ExportOPMLDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ExportOPMLDialog({ open, onOpenChange }: ExportOPMLDialogProps) {
  const feeds = useRSSStore(state => state.feeds)

  const handleExport = () => {
    // 生成 OPML 内容
    const opml = generateOPML(feeds)

    // 下载文件
    const blob = new Blob([opml], { type: 'text/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'feeds.opml'
    a.click()

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export OPML</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <p>导出 {feeds.length} 个订阅源为 OPML 文件。</p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleExport}>导出</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function generateOPML(feeds: Feed[]): string {
  // OPML 生成逻辑
  return `<?xml version="1.0"?>...`
}
```

2. **在父组件中使用**：

```typescript
// 在 sidebar.tsx 或其他组件中
import { ExportOPMLDialog } from "./export-opml-dialog"

export function Sidebar() {
  const [showExport, setShowExport] = useState(false)

  return (
    <>
      <Button onClick={() => setShowExport(true)}>导出 OPML</Button>
      <ExportOPMLDialog open={showExport} onOpenChange={setShowExport} />
    </>
  )
}
```

**要点**：
- 对话框状态由父组件控制（受控组件）
- 使用 shadcn/ui 的 Dialog 组件
- 从 store 读取数据，不要在组件内部查询数据库

---

### 模式 2：添加新的 Zustand Action

**场景**：我要添加"全部标记为已读"功能。

**步骤**：

1. **在 `lib/store.ts` 添加 Action 接口**：

```typescript
interface RSSReaderActions {
  // ... 现有 actions
  markAllAsRead: (feedId?: string) => void  // 新增
}
```

2. **实现 Action**：

```typescript
export const useRSSStore = create<RSSReaderState & RSSReaderActions>()(
  persist(
    (set, get) => ({
      // ... 现有 state 和 actions

      markAllAsRead: (feedId) => {
        const state = get()

        // 找到要标记的文章
        const articlesToUpdate = feedId
          ? state.articles.filter(a => a.feedId === feedId && !a.isRead)
          : state.articles.filter(a => !a.isRead)

        // 更新本地状态
        set(state => ({
          articles: state.articles.map(a =>
            articlesToUpdate.find(au => au.id === a.id)
              ? { ...a, isRead: true }
              : a
          )
        }))

        // 批量更新数据库
        articlesToUpdate.forEach(article => {
          dbManager.updateArticle(article.id, { isRead: true }).catch(console.error)
        })
      }
    }),
    { /* ... persist config */ }
  )
)
```

3. **在组件中使用**：

```typescript
export function ArticleList() {
  const markAllAsRead = useRSSStore(state => state.markAllAsRead)
  const selectedFeedId = useRSSStore(state => state.selectedFeedId)

  return (
    <div>
      <Button onClick={() => markAllAsRead(selectedFeedId)}>
        全部标记为已读
      </Button>
      {/* ... */}
    </div>
  )
}
```

**要点**：
- Action 先更新本地状态，再异步更新数据库
- 批量操作用 `forEach` 或 `Promise.all`
- 错误处理用 `.catch(console.error)`

---

### 模式 3：添加数据库字段

**场景**：我要给 Feed 添加"自定义图标 URL"字段。

**步骤**：

1. **更新数据库 Schema**：

在 Supabase SQL Editor 运行：

```sql
ALTER TABLE feeds ADD COLUMN icon_url TEXT;
```

2. **更新 TypeScript 类型**（`lib/types.ts`）：

```typescript
export const FeedSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  iconUrl: z.string().url().optional(),  // 新增
  // ... 其他字段
})
```

3. **更新数据库映射**（`lib/db/settings.ts`）：

```typescript
// 添加应用层 → DB 层的转换
function feedToDb(feed: Feed): DbRow {
  return {
    id: feed.id,
    title: feed.title,
    url: feed.url,
    icon_url: feed.iconUrl || null,  // 新增：camelCase → snake_case
    folder_id: feed.folderId || null,
    order: feed.order ?? 0,           // 使用 ?? 处理 NOT NULL 字段
    unread_count: feed.unreadCount ?? 0,
    last_fetched: toISOString(feed.lastFetched),
  }
}

// 添加 DB 层 → 应用层的转换
function dbRowToFeed(row: Database["public"]["Tables"]["feeds"]["Row"]): Feed {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    iconUrl: row.icon_url || undefined,  // 新增：snake_case → camelCase
    folderId: row.folder_id || undefined,
    order: row.order,
    unreadCount: row.unread_count,
    lastFetched: row.last_fetched ? new Date(row.last_fetched) : undefined,
  }
}
```

**注意**：现在使用泛型 Repository 模式，`feedsRepo.save()` 会自动调用 `feedToDb()` 转换，
无需修改 `saveFeeds()` 方法。

**处理 NOT NULL 约束的最佳实践**：

如果新字段有 NOT NULL 约束，必须在两个地方保证非空：

1. **Store Actions**：创建对象时提供默认值

```typescript
addFeed: (feed) => {
  const state = get()
  const maxOrder = state.feeds.reduce((max, f) => Math.max(max, f.order ?? -1), -1)

  const newFeed: Feed = {
    id: crypto.randomUUID(),
    order: maxOrder + 1,      // 自动计算，保证有值
    unreadCount: 0,           // 默认值
    iconUrl: undefined,       // 可选字段可以是 undefined
    ...feed,                  // 用户传入的值覆盖默认值
  }
  // ...
}
```

2. **转换函数**：使用 `??` 运算符作为最后防线

```typescript
function feedToDb(feed: Feed): DbRow {
  return {
    order: feed.order ?? 0,              // 如果仍是 undefined，用 0
    unread_count: feed.unreadCount ?? 0,
    icon_url: feed.iconUrl || null,      // 可选字段可以是 null
    // ...
  }
}
```

4. **更新 UI 使用新字段**：

```typescript
export function Sidebar() {
  const feeds = useRSSStore(state => state.feeds)

  return (
    <div>
      {feeds.map(feed => (
        <div key={feed.id}>
          {feed.iconUrl && <img src={feed.iconUrl} alt="" />}
          <span>{feed.title}</span>
        </div>
      ))}
    </div>
  )
}
```

5. **（可选）在添加 Feed 时抓取图标**：

在 `app/api/rss/parse/route.ts` 中：

```typescript
const feed = await parser.parseURL(url)

return NextResponse.json({
  feed: {
    title: feed.title,
    description: feed.description,
    link: feed.link,
    iconUrl: feed.image?.url || null,  // 从 RSS 元数据获取
  },
  articles: [...],
})
```

**要点**：
- 数据库字段用 `snake_case`，应用层用 `camelCase`
- 可选字段用 `optional()` 和 `|| undefined` / `|| null`
- 记得同时更新读和写的转换函数

---

### 模式 4：添加 API Route

**场景**：我要添加一个"查找相似文章"的 API。

**步骤**：

1. **创建 API 文件**：`app/api/articles/similar/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"
import { dbManager } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const { articleId } = await request.json()

    // 查找文章
    const articles = await dbManager.loadArticles()
    const article = articles.find(a => a.id === articleId)

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 })
    }

    // 简单相似度算法：匹配标题关键词
    const keywords = article.title.toLowerCase().split(' ')
    const similar = articles
      .filter(a => a.id !== articleId)
      .filter(a => keywords.some(kw => a.title.toLowerCase().includes(kw)))
      .slice(0, 5)

    return NextResponse.json({ similar })
  } catch (error) {
    console.error("Error finding similar articles:", error)
    return NextResponse.json(
      { error: "Failed to find similar articles" },
      { status: 500 }
    )
  }
}
```

2. **创建客户端调用函数**（`lib/article-utils.ts`）：

```typescript
export async function findSimilarArticles(articleId: string) {
  const response = await fetch("/api/articles/similar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articleId }),
  })

  if (!response.ok) {
    throw new Error("Failed to find similar articles")
  }

  const { similar } = await response.json()
  return similar
}
```

3. **在组件中使用**：

```typescript
export function ArticleContent() {
  const [similar, setSimilar] = useState([])
  const selectedArticleId = useRSSStore(state => state.selectedArticleId)

  useEffect(() => {
    if (selectedArticleId) {
      findSimilarArticles(selectedArticleId).then(setSimilar)
    }
  }, [selectedArticleId])

  return (
    <div>
      <h3>相似文章</h3>
      {similar.map(article => <div key={article.id}>...</div>)}
    </div>
  )
}
```

**要点**：
- API Route 必须导出 `GET`、`POST` 等命名函数
- 用 `NextResponse.json()` 返回 JSON
- 错误处理返回对应的 HTTP 状态码
- 客户端封装 `fetch` 调用为独立函数

---

### 模式 5：优化查询性能

**场景**：查询某个 Feed 的未读文章很慢。

**步骤**：

1. **分析慢查询**：

在 Supabase Dashboard → Database → Query Performance 查看慢查询。

2. **添加索引**：

在 SQL Editor 运行：

```sql
-- 复合索引：加速"某个 Feed 的未读文章"查询
CREATE INDEX IF NOT EXISTS idx_articles_feed_unread
ON articles(feed_id, is_read);

-- 或者用表达式索引
CREATE INDEX IF NOT EXISTS idx_articles_unread_by_feed
ON articles(feed_id) WHERE is_read = false;
```

3. **更新初始化脚本**（`scripts/001_create_tables.sql`）：

在文件末尾添加新索引，供新用户使用。

4. **优化查询逻辑**（如果需要）：

```typescript
// 之前：加载所有文章，再在内存过滤
const allArticles = await dbManager.loadArticles()
const unread = allArticles.filter(a => !a.isRead)

// 优化后：在数据库过滤
async loadUnreadArticles(feedId?: string): Promise<Article[]> {
  const supabase = createClient()

  let query = supabase
    .from("articles")
    .select("*")
    .eq("is_read", false)
    .order("published_at", { ascending: false })

  if (feedId) {
    query = query.eq("feed_id", feedId)
  }

  const { data, error } = await query
  if (error) throw error

  return (data || []).map(dbRowToArticle)
}
```

**要点**：
- 索引选择：根据 WHERE 条件和 ORDER BY 字段
- 复合索引顺序：最常用的字段放前面
- 表达式索引：适合固定过滤条件（如 `WHERE is_read = false`）

---

## 调试技巧

### 1. 调试 Zustand Store

**查看当前状态**：

```typescript
// 在浏览器控制台运行
console.log(window.useRSSStore.getState())
```

**监听状态变化**：

```typescript
useRSSStore.subscribe((state) => {
  console.log('Store updated:', state)
})
```

### 2. 调试 Supabase 查询

**启用详细日志**：

```typescript
import { createClient } from "@/lib/supabase/client"

const supabase = createClient()

// 在查询前添加日志
console.log('Querying articles...')
const { data, error } = await supabase.from("articles").select("*")
console.log('Result:', { data, error })
```

**在 Supabase Dashboard 查看日志**：

Dashboard → Logs → Postgres Logs

### 3. 调试实时同步

**检查连接状态**：

```typescript
const channel = realtimeManager.subscribeToFeeds(...)
console.log('Channel state:', channel.state)  // 应该是 "joined"
```

**查看事件日志**：

在 `lib/realtime.ts` 的回调中已经有 `console.log`，检查浏览器控制台。

### 4. 调试 RSS 解析

**查看服务端日志**：

在 `app/api/rss/parse/route.ts` 添加日志：

```typescript
console.log('[RSS] Parsing URL:', url)
const feed = await parser.parseURL(url)
console.log('[RSS] Parsed feed:', feed.title, feed.items.length)
```

日志会显示在运行 `pnpm dev` 的终端。

---

## 常见开发陷阱

### 陷阱 1：忘记 "use client"

**症状**：组件报错 `useState` 或 `useEffect` undefined。

**原因**：Next.js 默认是 Server Component，不能用 React Hooks。

**解决**：文件顶部添加 `"use client"`。

```typescript
"use client"  // 必须是文件第一行

import { useState } from "react"
```

### 陷阱 2：在 useEffect 中忘记依赖

**症状**：状态更新后，effect 不重新运行。

**解决**：添加依赖，或用 ESLint 自动修复。

```typescript
// ❌ 错误
useEffect(() => {
  loadData(feedId)
}, [])  // 缺少 feedId 依赖

// ✅ 正确
useEffect(() => {
  loadData(feedId)
}, [feedId])
```

### 陷阱 3：异步 Action 中的闭包陷阱

**症状**：Action 中读取的 state 是旧值。

**原因**：异步函数捕获了旧的闭包。

**解决**：用 `get()` 获取最新状态。

```typescript
// ❌ 错误
addFeed: async (feed) => {
  set(state => ({ feeds: [...state.feeds, feed] }))

  // 延迟后读取 feeds，可能是旧值
  setTimeout(() => {
    console.log(state.feeds)  // 闭包中的 state 是旧的！
  }, 1000)
}

// ✅ 正确
addFeed: async (feed) => {
  set(state => ({ feeds: [...state.feeds, feed] }))

  setTimeout(() => {
    const currentState = get()  // 获取最新状态
    console.log(currentState.feeds)
  }, 1000)
}
```

### 陷阱 4：直接修改 State

**症状**：修改数据后，UI 不更新。

**原因**：Zustand 检测不到对象/数组的直接修改。

**解决**：用展开运算符创建新对象/数组。

```typescript
// ❌ 错误
set(state => {
  state.feeds.push(newFeed)  // 直接修改数组
  return { feeds: state.feeds }
})

// ✅ 正确
set(state => ({
  feeds: [...state.feeds, newFeed]  // 创建新数组
}))
```

---

## 下一步

- 查看 [常见任务](./06-common-tasks.md) 了解具体开发场景
- 查看 [故障排查](./07-troubleshooting.md) 解决常见问题