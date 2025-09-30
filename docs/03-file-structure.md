# 文件结构详解

## 项目目录树

```
rssreader3/
├── app/                      # Next.js App Router
│   ├── layout.tsx           # 根布局
│   ├── page.tsx             # 首页（入口）
│   └── api/                 # API Routes
│       └── rss/
│           ├── parse/       # RSS 解析
│           └── validate/    # RSS 验证
├── components/              # React 组件
│   ├── ui/                  # shadcn/ui 组件库
│   ├── rss-reader.tsx       # 主组件
│   ├── sidebar.tsx          # 侧边栏
│   ├── article-list.tsx     # 文章列表
│   ├── article-content.tsx  # 文章内容
│   └── [其他对话框组件]
├── lib/                     # 核心逻辑
│   ├── store.ts             # Zustand 状态管理
│   ├── db.ts                # Supabase 数据库操作
│   ├── types.ts             # 类型定义
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
**作用**：应用入口，渲染主组件。

```typescript
export default function Home() {
  return <RSSReader />  // 就这么简单
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
getFilteredArticles: () => {
  let filtered = state.articles

  // 1. 按选中的 Feed 过滤
  if (selectedFeedId) {
    filtered = filtered.filter(a => a.feedId === selectedFeedId)
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

#### `lib/db.ts` ⭐️ **数据库抽象层**

**作用**：封装所有 Supabase 操作，提供类型安全的接口。

**关键类**：`SupabaseManager`

**主要方法**：
- `saveFolders(folders)`：批量保存文件夹
- `saveFeeds(feeds)`：批量保存订阅源
- `saveArticles(articles)`：批量保存文章
- `loadFolders()`：加载所有文件夹
- `updateArticle(id, updates)`：更新单篇文章
- `clearOldArticles(daysToKeep)`：清理旧文章
- `isDatabaseInitialized()`：检查数据库是否初始化

**类型转换**：
- `dbRowToFeed(row)`：数据库行 → Feed 对象
- `toISOString(date)`：Date → ISO string

**为什么需要转换**：
- 数据库字段用 `snake_case`（如 `feed_id`）
- 应用层用 `camelCase`（如 `feedId`）
- 日期在数据库存字符串，应用层用 Date 对象

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

#### `components/rss-reader.tsx` ⭐️ **主组件**
**作用**：应用根组件，处理初始化逻辑。

**流程**：
1. 检查 `isDatabaseReady`
2. 如果 false，显示 `DatabaseSetup`
3. 如果 true，调用 `loadFromSupabase()`
4. 加载完成后，渲染主界面（Sidebar + ArticleList + ArticleContent）

#### `components/sidebar.tsx`
**作用**：左侧边栏，显示文件夹和订阅源。

**功能**：
- 显示文件夹树
- 显示订阅源列表（可拖拽到文件夹）
- 显示未读数量 Badge
- "All Articles"、"Unread"、"Starred" 视图切换

#### `components/article-list.tsx`
**作用**：中间栏，显示文章列表。

**关键**：
- 调用 `getFilteredArticles()` 获取过滤后的文章
- 支持虚拟滚动（长列表性能优化）
- 点击文章时调用 `setSelectedArticle()`

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

#### `components/settings-dialog.tsx`
**作用**：设置对话框。

**包含设置**：
- 主题（亮色/暗色/系统）
- 字体大小
- 自动刷新间隔
- 文章保留天数
- 等等...

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
- `r`：标记已读
- `s`：收藏
- `Enter`：打开文章
- 等等...

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
| 添加新的应用设置 | `lib/types.ts` (AppSettings), `lib/db.ts` (settings 转换), `components/settings-dialog.tsx` (UI) |
| 新增 Feed 属性 | `lib/types.ts` (FeedSchema), `scripts/001_create_tables.sql` (迁移), `lib/db.ts` (转换函数), Supabase 执行 ALTER TABLE |
| 添加新的 UI 组件 | `components/` 目录，遵循 shadcn/ui 模式 |
| 修改 RSS 解析逻辑 | `app/api/rss/parse/route.ts` |
| 添加新的 Zustand action | `lib/store.ts` (RSSReaderActions 接口 + 实现) |
| 优化查询性能 | `scripts/001_create_tables.sql` 添加索引 |

## 下一步

- 查看 [数据流详解](./04-data-flow.md) 了解数据如何流动
- 查看 [开发指南](./05-development-guide.md) 学习开发流程