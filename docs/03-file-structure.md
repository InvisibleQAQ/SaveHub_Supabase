# 文件结构详解

## 项目目录树

```
rssreader3/
├── app/                      # Next.js App Router
│   ├── layout.tsx           # 根布局
│   ├── page.tsx             # 首页（重定向到 /all）
│   ├── (reader)/            # 路由组（共享布局）
│   │   ├── layout.tsx       # Reader 布局（Sidebar + 内容区）
│   │   ├── all/
│   │   │   └── page.tsx     # /all - 所有文章
│   │   ├── unread/
│   │   │   └── page.tsx     # /unread - 未读文章
│   │   ├── starred/
│   │   │   └── page.tsx     # /starred - 收藏文章
│   │   ├── feed/
│   │   │   └── [feedId]/
│   │   │       └── page.tsx # /feed/[feedId] - 特定订阅源
│   │   └── settings/        # 设置页面
│   │       ├── layout.tsx   # Settings 布局（左侧导航+右侧内容）
│   │       ├── page.tsx     # /settings - 重定向到 general
│   │       ├── general/
│   │       │   └── page.tsx # /settings/general - 通用设置
│   │       ├── appearance/
│   │       │   └── page.tsx # /settings/appearance - 外观设置
│   │       └── storage/
│   │           └── page.tsx # /settings/storage - 存储设置
│   └── api/                 # API Routes
│       └── rss/
│           ├── parse/       # RSS 解析
│           └── validate/    # RSS 验证
├── components/              # React 组件
│   ├── ui/                  # shadcn/ui 组件库
│   ├── sidebar/             # 侧边栏模块（模块化重构）
│   │   ├── index.tsx        # 主入口组件
│   │   ├── types.ts         # 共享类型定义
│   │   ├── use-sidebar-state.ts  # 状态管理 hook
│   │   ├── collapsed-view.tsx    # 收缩视图
│   │   ├── expanded-view.tsx     # 展开视图
│   │   ├── view-button.tsx       # 视图切换按钮（复用组件）
│   │   ├── feed-item.tsx         # Feed 项组件
│   │   ├── folder-item.tsx       # 文件夹项组件
│   │   ├── feed-actions-menu.tsx   # Feed 操作菜单
│   │   └── folder-actions-menu.tsx # 文件夹操作菜单
│   ├── article-list.tsx     # 文章列表（接收 viewMode/feedId props）
│   ├── article-content.tsx  # 文章内容
│   ├── keyboard-shortcuts.tsx # 键盘快捷键（使用 router.push）
│   └── [其他对话框组件]
├── lib/                     # 核心逻辑
│   ├── store.ts             # Zustand 状态管理（移除了 viewMode/selectedFeedId）
│   ├── db.ts                # Supabase 数据库操作
│   ├── types.ts             # 类型定义（移除了 viewMode/selectedFeedId）
│   ├── rss-parser.ts        # RSS 解析客户端
│   ├── realtime.ts          # 实时同步管理
│   ├── utils.ts             # 工具函数
│   └── supabase/            # Supabase 客户端
│       ├── client.ts        # 浏览器端客户端
│       ├── server.ts        # 服务端客户端
│       └── types.ts         # 数据库类型（自动生成）
├── hooks/                   # 自定义 Hooks
│   ├── use-realtime-sync.ts # 实时同步 Hook
│   ├── use-mobile.ts        # 移动端检测
│   └── use-toast.ts         # Toast 通知
├── scripts/                 # 数据库脚本
│   └── 001_create_tables.sql
├── styles/                  # 全局样式
└── public/                  # 静态资源
```

## 核心文件详解

### 📂 `app/` - Next.js 路由

#### `app/page.tsx`
**作用**：应用入口，重定向到 `/all`。

```typescript
import { redirect } from "next/navigation"

export default function Home() {
  redirect("/all")  // URL 是单一真相来源
}
```

#### `app/(reader)/layout.tsx`
**作用**：共享布局，包含 Sidebar 和数据加载逻辑。

**关键点**：
- 所有 reader 路由共享此布局
- 处理数据库初始化检查
- 调用 `loadFromSupabase()` 加载数据
- 包裹 Sidebar 和 children（ArticleList + ArticleContent）

#### `app/(reader)/all/page.tsx`
**作用**：显示所有文章。

```typescript
export default function AllArticlesPage() {
  return (
    <>
      <div className="w-96"><ArticleList viewMode="all" /></div>
      <div className="flex-1"><ArticleContent /></div>
    </>
  )
}
```

#### `app/(reader)/unread/page.tsx`
**作用**：显示未读文章。

```typescript
export default function UnreadArticlesPage() {
  return (
    <>
      <div className="w-96"><ArticleList viewMode="unread" /></div>
      <div className="flex-1"><ArticleContent /></div>
    </>
  )
}
```

#### `app/(reader)/starred/page.tsx`
**作用**：显示收藏文章。

#### `app/(reader)/feed/[feedId]/page.tsx`
**作用**：显示特定订阅源的文章。

```typescript
export default function FeedArticlesPage({ params }: { params: { feedId: string } }) {
  return (
    <>
      <div className="w-96"><ArticleList feedId={params.feedId} /></div>
      <div className="flex-1"><ArticleContent /></div>
    </>
  )
}
```

#### `app/layout.tsx`
**作用**：根布局，设置主题、字体、元数据。

**关键点**：
- 包裹 `ThemeProvider`（支持亮色/暗色主题）
- 引入 Geist 字体
- 设置 `<head>` 元数据

#### `app/api/rss/parse/route.ts`
**作用**：解析 RSS 源，返回 Feed 元数据和文章列表。

**为什么需要它**：`rss-parser` 库只能在 Node.js 环境运行。

**输入**：
```json
{
  "url": "https://example.com/feed.xml",
  "feedId": "uuid"
}
```

**输出**：
```json
{
  "feed": {
    "title": "Blog Title",
    "description": "...",
    "link": "https://..."
  },
  "articles": [
    {
      "id": "uuid",
      "title": "Article 1",
      "content": "...",
      ...
    }
  ]
}
```

#### `app/api/rss/validate/route.ts`
**作用**：验证 URL 是否是有效的 RSS 源。

**为什么需要它**：在添加 Feed 前预检查，避免无效输入。

---

### 📂 `lib/` - 核心业务逻辑

#### `lib/store.ts` ⭐️ **最重要的文件**

**作用**：Zustand 状态管理，整个应用的数据中心。

**包含内容**：
1. **State**：folders、feeds、articles、UI 状态
2. **Actions**：所有修改数据的方法
3. **Computed Getters**：`getFilteredArticles()`、`getUnreadCount()`

**关键 Actions**：
- `addFeed(feed)`：添加订阅源
- `addArticles(articles)`：添加文章（自动去重）
- `markAsRead(articleId)`：标记文章已读
- `toggleStar(articleId)`：切换收藏
- `syncToSupabase()`：同步到数据库
- `loadFromSupabase()`：从数据库加载

**何时调用 `syncToSupabase()`**：
- 每次修改 folders、feeds 时
- **不在**修改 articles 时调用（性能考虑，直接 `dbManager.updateArticle`）

**数据过滤逻辑**：
```typescript
getFilteredArticles: ({ viewMode = "all", feedId = null }) => {
  let filtered = state.articles

  // 1. 按选中的 Feed 过滤
  if (feedId) {
    filtered = filtered.filter(a => a.feedId === feedId)
  }

  // 2. 按查看模式过滤（all/unread/starred）
  if (viewMode === 'unread') {
    filtered = filtered.filter(a => !a.isRead)
  }

  // 3. 按搜索词过滤
  if (searchQuery) {
    filtered = filtered.filter(a =>
      a.title.includes(searchQuery) || ...
    )
  }

  return filtered.sort(...)  // 按发布时间排序
}
```

**重要变更**：`getFilteredArticles` 现在接收 `{ viewMode, feedId }` 参数，而不是从 store 读取。

#### `lib/db.ts` ⭐️ **数据库抽象层**

**作用**：封装所有 Supabase 操作，提供类型安全的接口。

**架构设计**：采用泛型 Repository 模式消除 CRUD 重复代码。

**核心类**：

1. **GenericRepository<TApp, TDb>** - 通用 CRUD 模板
   ```typescript
   class GenericRepository<TApp, TDb> {
     constructor(
       tableName: string,
       toDb: (item: TApp) => TDb,      // 应用类型 → DB 类型
       fromDb: (row: TDb) => TApp,     // DB 类型 → 应用类型
       orderBy?: { column, ascending }
     )

     async save(items: TApp[]): Promise<void>
     async load(): Promise<TApp[]>
     async delete(id: string): Promise<void>
   }
   ```

2. **SupabaseManager** - 主管理类
   ```typescript
   class SupabaseManager {
     // 使用泛型仓库实例
     private foldersRepo = new GenericRepository(...)
     private feedsRepo = new GenericRepository(...)
     private articlesRepo = new GenericRepository(...)

     // 委托方法（不再有重复的 CRUD 代码）
     async saveFolders(folders: Folder[]) {
       return this.foldersRepo.save(folders)
     }

     async loadFolders(): Promise<Folder[]> {
       return this.foldersRepo.load()
     }

     // ...其他委托方法
   }
   ```

**主要方法**：
- `saveFolders(folders)` / `saveFeeds(feeds)` / `saveArticles(articles)`：批量保存
- `loadFolders()` / `loadFeeds()` / `loadArticles()`：加载所有
- `deleteFolder(id)` / `deleteFeed(id)`：删除单个
- `updateArticle(id, updates)`：更新单篇文章（使用字段映射表，不再是 9 个 if 判断）
- `clearOldArticles(daysToKeep)`：清理旧文章
- `isDatabaseInitialized()`：检查数据库是否初始化

**类型转换**：
```typescript
// 应用层 → DB 层
function feedToDb(feed: Feed): DbRow {
  return {
    id: feed.id,
    title: feed.title,
    folder_id: feed.folderId || null,              // camelCase → snake_case
    last_fetched: toISOString(feed.lastFetched),   // Date → ISO string
  }
}

// DB 层 → 应用层
function dbRowToFeed(row: DbRow): Feed {
  return {
    id: row.id,
    title: row.title,
    folderId: row.folder_id || undefined,          // snake_case → camelCase
    lastFetched: row.last_fetched ? new Date(row.last_fetched) : undefined,
  }
}

// 部分更新转换（消除 9 个 if 判断）
function articlePartialToDb(updates: Partial<Article>): DbRow {
  const fieldMap = {
    isRead: "is_read",
    isStarred: "is_starred",
    publishedAt: "published_at",
    // ...
  }

  const dbUpdates: DbRow = {}
  for (const [appKey, dbKey] of Object.entries(fieldMap)) {
    const value = updates[appKey]
    if (value !== undefined) {
      dbUpdates[dbKey] = value instanceof Date ? toISOString(value) : value
    }
  }
  return dbUpdates
}
```

**为什么需要转换**：
- 数据库字段用 `snake_case`（如 `feed_id`）
- 应用层用 `camelCase`（如 `feedId`）
- 日期在数据库存字符串，应用层用 Date 对象

**设计优势**：
1. **消除重复**：save/load/delete 操作从 ~99行重复代码 → 33行泛型模板
2. **类型安全**：消除了 `any` 类型，通过转换函数确保类型正确
3. **可扩展**：添加新实体只需 3 步骤（定义转换函数 → 创建 Repository 实例 → 委托方法）
4. **单一职责**：Repository 处理数据库，转换函数处理类型映射

#### `lib/types.ts`
**作用**：定义应用的核心类型。

**包含**：
- Zod schemas：`FeedSchema`、`ArticleSchema`、`FolderSchema`
- TypeScript types：从 Zod 推断
- `RSSReaderState` 接口

**为什么用 Zod**：
- 运行时类型验证
- 自动生成 TypeScript 类型
- 表单验证（配合 react-hook-form）

#### `lib/rss-parser.ts`
**作用**：客户端调用 RSS API 的封装。

**主要函数**：
- `parseRSSFeed(url, feedId)`：解析 RSS
- `validateRSSUrl(url)`：验证 URL
- `discoverRSSFeeds(url)`：猜测可能的 RSS URL

**使用示例**：
```typescript
const { feed, articles } = await parseRSSFeed(url, feedId)
addFeed(feed)
addArticles(articles)
```

#### `lib/realtime.ts`
**作用**：管理 Supabase Realtime 订阅。

**类**：`RealtimeManager`

**方法**：
- `subscribeToFeeds(onInsert, onUpdate, onDelete)`
- `subscribeToArticles(...)`
- `subscribeToFolders(...)`
- `unsubscribeAll()`

**何时使用**：在 `use-realtime-sync.ts` hook 中调用。

#### `lib/supabase/client.ts`
**作用**：浏览器端 Supabase 客户端。

```typescript
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

#### `lib/supabase/server.ts`
**作用**：服务端 Supabase 客户端（支持 cookies）。

**使用场景**：Server Components 或 API Routes（目前未使用）。

#### `lib/supabase/types.ts`
**作用**：Supabase 数据库类型定义（自动生成）。

**如何生成**：
```bash
supabase gen types typescript --project-id xxhlzzntzrdktyzkjpxu > lib/supabase/types.ts
```

**注意**：目前是手动编写的，如果使用 Supabase CLI 可以自动生成。

---

### 📂 `hooks/` - 自定义 Hooks

#### `hooks/use-realtime-sync.ts` ⭐️
**作用**：订阅 Supabase Realtime 更新，自动同步数据。

**逻辑**：
1. 监听 feeds、articles、folders 表的 INSERT/UPDATE/DELETE
2. 收到事件时，更新 Zustand store
3. 组件卸载时，取消订阅

**使用**：在 `rss-reader.tsx` 中调用 `useRealtimeSync()`。

#### `hooks/use-mobile.ts`
**作用**：检测是否移动端，响应式设计用。

```typescript
const isMobile = useMobile()
if (isMobile) {
  // 显示移动端布局
}
```

#### `hooks/use-toast.ts`
**作用**：Toast 通知 Hook（shadcn/ui）。

```typescript
const { toast } = useToast()
toast({ title: "Success", description: "..." })
```

---

### 📂 `components/` - React 组件

#### `components/sidebar/` ⭐ **模块化重构**

**作用**：侧边栏模块，采用职责分离的模块化架构。

**重构原因**：
- 原 `sidebar.tsx` 685 行，包含 3 个独立功能混在一起
- 收缩视图和展开视图通过 if 分支切换，导致代码复杂
- 大量重复代码（如 dropdown menu 重复 2 次）

**新架构** (10 个文件，每个 <100 行):

```
sidebar/
├── index.tsx (90行)               # 主入口：状态管理 + 视图路由
├── types.ts (10行)                 # RenameDialogState, MoveDialogState
├── use-sidebar-state.ts (52行)    # 本地状态管理 hook
│
├── 视图组件 (职责分离)
│   ├── collapsed-view.tsx (70行)  # 收缩视图（图标模式）
│   └── expanded-view.tsx (255行)  # 展开视图（完整模式）
│
├── 原子组件 (可复用)
│   ├── view-button.tsx (55行)     # All/Unread/Starred 按钮（支持 icon/full 模式）
│   ├── feed-item.tsx (90行)       # Feed 项（支持 icon/full 模式）
│   └── folder-item.tsx (85行)     # 文件夹项 + 子 feed 列表
│
└── 操作菜单 (消除重复)
    ├── feed-actions-menu.tsx (85行)    # Feed 右键菜单（刷新/移动/重命名/删除）
    └── folder-actions-menu.tsx (65行)  # 文件夹右键菜单（添加/重命名/删除）
```

**核心改进**：

1. **消除特殊情况** - collapsed/expanded 不再是 if 分支，而是两个独立组件
2. **消除重复代码** - dropdown menu 从 2 次变为 1 次（提取为独立组件）
3. **单一职责** - 每个文件只做一件事，易于理解和维护
4. **可复用性** - `view-button` 和 `feed-item` 支持 `icon/full` 两种模式
5. **可测试性** - 每个组件可独立测试

**使用方式**（外部组件无需修改）:
```typescript
import { Sidebar } from "@/components/sidebar"  // 自动解析到 sidebar/index.tsx

// 组件内部根据 isSidebarCollapsed 自动切换 CollapsedView/ExpandedView
```

**数据流**:
```typescript
index.tsx (主入口)
  ├── useSidebarState() → 管理 dialog 和搜索状态
  ├── useRSSStore() → 读取 folders/feeds/articles
  └── 根据 isSidebarCollapsed 渲染:
      ├── CollapsedView (收缩视图)
      └── ExpandedView (展开视图)
          ├── FolderItem → FeedItem (递归渲染文件夹树)
          └── FeedItem (无文件夹的 feed)
```

#### `components/article-list.tsx`
**作用**：中间栏，显示文章列表。

**关键**：
- 接收 `viewMode` 和 `feedId` props（从路由派生）
- 调用 `getFilteredArticles({ viewMode, feedId })` 获取过滤后的文章
- 支持虚拟滚动（长列表性能优化）
- 点击文章时调用 `setSelectedArticle()`

**接口**：
```typescript
interface ArticleListProps {
  viewMode?: "all" | "unread" | "starred"
  feedId?: string | null
}
```

#### `components/article-content.tsx`
**作用**：右侧栏，显示文章详情。

**功能**：
- 渲染 HTML 内容
- 显示作者、发布时间
- 标记已读/未读、收藏按钮
- 在新标签页打开原文链接

#### `components/add-feed-dialog.tsx`
**作用**：添加订阅源对话框。

**流程**：
1. 用户输入 URL
2. 调用 `validateRSSUrl()` 验证
3. 调用 `parseRSSFeed()` 解析
4. 调用 `addFeed()` 和 `addArticles()` 保存
5. 关闭对话框

#### `components/add-folder-dialog.tsx`
**作用**：添加文件夹对话框。

### 📂 `app/(reader)/settings/` - 设置页面

#### `app/(reader)/settings/layout.tsx`
**作用**：Settings 页面布局，左侧导航 + 右侧配置内容。

**结构**：
```
┌──────────┬───────────────┐
│ 左侧导航   │ 右侧配置内容 │
│ General   │ [配置表单]     │
│ Appearance│                │
│ Storage   │                │
└──────────┴───────────────┘
```

#### `app/(reader)/settings/page.tsx`
**作用**：重定向到 `/settings/general`。

#### `app/(reader)/settings/general/page.tsx`
**作用**：通用设置页面。

**包含设置**：
- 自动刷新开关
- 刷新间隔（5-120分钟）

#### `app/(reader)/settings/appearance/page.tsx`
**作用**：外观设置页面。

**包含设置**：
- 主题（亮色/暗色/系统）
- 字体大小（12-24px）
- 显示缩略图
- 滚动时标记已读

#### `app/(reader)/settings/storage/page.tsx`
**作用**：存储设置页面。

**包含设置**：
- 文章保留天数（7-365天）
- 导出数据（JSON 格式）
- 导入数据
- 清除所有数据

**设计决策**：
- 不使用弹窗，而是独立路由页面
- 原因：统一性、可分享 URL、浏览器友好、更好的 UX

#### `components/database-setup.tsx`
**作用**：数据库未初始化时的引导界面。

**显示内容**：
- 说明需要运行 SQL 脚本
- 显示 SQL 脚本内容
- "Copy SQL" 按钮
- "I've run the script" 按钮重新检查

#### `components/feed-refresh.tsx`
**作用**：刷新订阅源组件。

**功能**：
- 刷新单个 Feed
- 刷新所有 Feeds
- 显示刷新进度

#### `components/keyboard-shortcuts.tsx`
**作用**：全局键盘快捷键。

**快捷键**：
- `j/k`：上/下一篇文章
- `m`：标记已读/未读
- `s`：收藏
- `Enter`：打开文章
- `1`：跳转到 All Articles（`router.push('/all')`）
- `2`：跳转到 Unread（`router.push('/unread')`）
- `3`：跳转到 Starred（`router.push('/starred')`）
- `,`：打开设置页面（`router.push('/settings')`）

**关键变更**：
```typescript
// 旧版本：修改 store 状态
case '1':
  setViewMode('all')
  break

// 新版本：使用 router.push 导航
case '1':
  router.push('/all')
  break
```

**实现细节**：
- 从 `usePathname()` 解析当前 viewMode 和 feedId
- 调用 `getFilteredArticles({ viewMode, feedId })` 获取当前视图的文章列表

#### `components/ui/*`
**作用**：shadcn/ui 组件库，无需修改。

---

### 📂 `scripts/`

#### `scripts/001_create_tables.sql`
**作用**：数据库初始化 SQL 脚本。

**创建的表**：
- `folders`：文件夹
- `feeds`：订阅源
- `articles`：文章
- `settings`：应用设置

**重要索引**：
- `idx_articles_feed_published`：加速"某个 Feed 的文章按时间排序"查询
- `idx_articles_is_read`：加速未读文章查询

---

## 文件关系图

```
用户交互
   ↓
rss-reader.tsx (主组件)
   ↓
├─ sidebar.tsx ───────→ useRSSStore (读取 folders/feeds)
├─ article-list.tsx ──→ useRSSStore (读取 getFilteredArticles)
└─ article-content.tsx → useRSSStore (读取 selectedArticle, 调用 markAsRead)
   ↓
useRSSStore (lib/store.ts)
   ↓
dbManager (lib/db.ts)
   ↓
Supabase Client (lib/supabase/client.ts)
   ↓
Supabase Postgres Database
   ↓
Realtime Channels
   ↓
use-realtime-sync.ts (监听变化)
   ↓
更新 useRSSStore
   ↓
UI 自动更新
```

## 何时修改哪些文件？

| 需求 | 修改文件 |
|-----|---------|
| 添加新的应用设置 | `lib/types.ts` (AppSettings), `lib/db.ts` (settings 转换), `app/(reader)/settings/*/page.tsx` (UI) |
| 新增 Feed 属性 | `lib/types.ts` (FeedSchema), `scripts/001_create_tables.sql` (迁移), `lib/db.ts` (转换函数), Supabase 执行 ALTER TABLE |
| 添加新的 UI 组件 | `components/` 目录，遵循 shadcn/ui 模式 |
| 修改 RSS 解析逻辑 | `app/api/rss/parse/route.ts` |
| 添加新的 Zustand action | `lib/store.ts` (RSSReaderActions 接口 + 实现) |
| 优化查询性能 | `scripts/001_create_tables.sql` 添加索引 |

## 下一步

- 查看 [数据流详解](./04-data-flow.md) 了解数据如何流动
- 查看 [开发指南](./05-development-guide.md) 学习开发流程