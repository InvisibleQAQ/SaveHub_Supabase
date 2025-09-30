# 项目架构详解

## 核心设计哲学

这个项目的架构基于一个简单原则：**数据流单向，职责分离**。

```
用户操作 → Zustand Store → Supabase Database
                ↑                  ↓
            实时更新 ←── Realtime Channels
```

## 三层架构

### 1. UI 层（React Components + Next.js Routing）

**职责**：显示数据，响应用户操作，管理路由状态。

**特点**：
- 组件只从 Zustand store 读数据
- 组件调用 store actions 修改数据
- **URL 是视图状态的单一真相来源**（viewMode 和 feedId 从路由派生）
- **不直接操作数据库**

**例子**：
```typescript
// ✅ 好的做法
function ArticleList() {
  const articles = useRSSStore(state => state.articles)
  const markAsRead = useRSSStore(state => state.markAsRead)

  return <div onClick={() => markAsRead(articleId)}>...</div>
}

// ❌ 错误做法
function ArticleList() {
  // 不要直接调用 dbManager
  dbManager.updateArticle(...)  // 这会破坏数据流
}
```

### 2. 状态管理层（Zustand Store）

**文件**：`lib/store.ts`

**职责**：
1. 存储所有应用数据（folders、feeds、articles）
2. 提供 actions 修改数据
3. 调用 `dbManager` 持久化数据

**关键概念**：Single Source of Truth（单一数据源）

**重要变更**：视图状态（viewMode、selectedFeedId）已从 store 移除，改为从 URL 路由派生。

所有数据都在 store 里，组件从 store 读，不从数据库读。视图状态从 URL params 读。

**数据流**：
```
用户点击按钮
  → 调用 store action（如 markAsRead）
  → 更新 store 状态
  → 调用 dbManager.updateArticle 持久化
  → UI 自动重新渲染（Zustand 响应式）
```

### 3. 持久化层（Supabase Manager）

**文件**：`lib/db.ts`

**职责**：
1. 封装所有数据库操作
2. 类型转换（camelCase ↔ snake_case）
3. 日期格式转换（Date ↔ ISO string）

**重要**：只有 store actions 调用 dbManager，组件永远不直接调用。

## 数据同步机制

### 初始化流程

```
1. App 启动
   ↓
2. 检查 isDatabaseReady（数据库是否初始化）
   ↓
3. 如果 false：显示 DatabaseSetup 组件，引导用户运行 SQL
   如果 true：继续
   ↓
4. 调用 loadFromSupabase()
   ↓
5. 从 Supabase 加载 folders、feeds、articles、settings
   ↓
6. 填充 Zustand store
   ↓
7. 订阅 Realtime channels（监听数据库变化）
   ↓
8. 渲染 UI
```

### 实时同步流程

当另一个客户端修改数据时：

```
其他客户端添加文章
  ↓
Supabase 数据库更新
  ↓
Realtime channel 推送事件
  ↓
本地 useRealtimeSync hook 接收
  ↓
更新 Zustand store
  ↓
UI 自动更新
```

**关键文件**：
- `lib/realtime.ts`：Realtime 管理器
- `hooks/use-realtime-sync.ts`：订阅实时更新的 hook

## RSS 抓取流程

添加 Feed 时发生了什么？

```
1. 用户点击 "Add Feed"，输入 URL
   ↓
2. 调用 parseRSSFeed(url, feedId)
   ↓
3. 发送 POST /api/rss/parse
   ↓
4. API Route 使用 rss-parser 库抓取
   ↓
5. 返回 { feed: {...}, articles: [...] }
   ↓
6. 调用 store.addFeed(feed)
   ↓
7. 调用 store.addArticles(articles)
   ↓
8. Store 自动去重（通过 article.id）
   ↓
9. 调用 dbManager 保存到 Supabase
   ↓
10. UI 显示新 Feed 和文章
```

**为什么用 API Route？**

因为 `rss-parser` 库依赖 Node.js 模块,不能在浏览器运行。所以抓取逻辑在服务端（API Route）。

## 路由架构

### URL 作为单一真相来源

本项目采用 **URL-first** 设计理念：视图状态（viewMode、feedId）从 URL 路由派生，而非存储在 Zustand store 中。

**路由列表**：

| 路由 | 功能 | 组件 |
|------|------|------|
| `/` | 重定向到 `/all` | `app/page.tsx` |
| `/all` | 显示所有文章 | `app/(reader)/all/page.tsx` |
| `/unread` | 显示未读文章 | `app/(reader)/unread/page.tsx` |
| `/starred` | 显示收藏文章 | `app/(reader)/starred/page.tsx` |
| `/feed/[feedId]` | 显示特定订阅源文章 | `app/(reader)/feed/[feedId]/page.tsx` |
| `/settings` | 重定向到 `/settings/general` | `app/(reader)/settings/page.tsx` |
| `/settings/general` | 通用设置（自动刷新、刷新间隔） | `app/(reader)/settings/general/page.tsx` |
| `/settings/appearance` | 外观设置（主题、字体、缩略图） | `app/(reader)/settings/appearance/page.tsx` |
| `/settings/storage` | 存储设置（数据保留、导入导出） | `app/(reader)/settings/storage/page.tsx` |

### 路由组（Route Groups）

**`app/(reader)/`** 路由组：

- 所有内容页面（文章列表、设置）共享此布局
- `layout.tsx` 处理：
  - 数据库初始化检查
  - 数据加载（`loadFromSupabase()`）
  - 侧边栏渲染
  - 实时同步启动

### 导航机制

**1. Sidebar 链接导航**：
```typescript
<Link href="/all">All Articles</Link>
<Link href="/settings">Settings</Link>
```

**2. 键盘快捷键导航**：
```typescript
router.push("/all")      // 按 1 键
router.push("/unread")   // 按 2 键
router.push("/starred")  // 按 3 键
router.push("/settings") // 按 , 键
```

**3. 编程式导航**：
```typescript
const router = useRouter()
router.push(`/feed/${feedId}`)
```

### Settings 页面架构

Settings 采用 **独立页面** 设计（非弹窗），占据原文章列表+内容区域。

**布局结构**：
```
┌─────────────┬──────────────────────────┐
│  Sidebar    │  Settings Layout         │
│             ├──────────┬───────────────┤
│  Feeds      │  左侧导航 │  右侧配置内容  │
│  ...        │  General │  [配置表单]    │
│             │  Appearance                │
│             │  Storage │                │
└─────────────┴──────────┴───────────────┘
```

**为什么不用弹窗？**

1. **统一性**：所有功能都是路由页面，没有特殊情况
2. **可分享**：可以直接分享 `/settings` 链接
3. **浏览器友好**：支持前进/后退按钮
4. **更好的UX**：更多空间显示配置项，不受弹窗大小限制

## 关键设计决策

### 为什么用 Zustand 而不是 React Context？

1. **性能**：Zustand 支持细粒度订阅，只有用到的组件才重新渲染
2. **简洁**：不需要 Provider 包裹，直接 `useRSSStore()`
3. **持久化**：内置 `persist` 中间件，自动保存到 localStorage

### 为什么不使用 localStorage 持久化？

**旧版本（已移除）**：
```typescript
// ❌ 已移除
partialize: (state) => ({
  viewMode: state.viewMode,
  selectedFeedId: state.selectedFeedId,
})
```

**新版本（当前）**：
- **不持久化任何 UI 状态**
- URL 就是持久化机制（用户可以收藏/分享链接）
- Store 只管理数据，不管理视图状态

**原因**：
- Folders、feeds、articles 数据量大，Supabase 是真正的数据源
- viewMode 和 selectedFeedId 现在由路由管理（`/all`, `/unread`, `/starred`, `/feed/[feedId]`）
- URL 作为单一真相来源，支持浏览器前进/后退、分享链接等 Web 标准功能
- 避免 localStorage 和 URL 状态不一致问题

### 为什么需要 isDatabaseReady 状态？

**问题**：如果用户第一次打开应用，数据库表还不存在，查询会报错。

**解决**：
1. 启动时先调用 `dbManager.isDatabaseInitialized()`
2. 尝试查询 settings 表
3. 如果失败，显示 DatabaseSetup 组件
4. 用户手动运行 SQL 后，点击 "I've run the script" 重新检查

### Date 类型处理

**问题**：JavaScript Date 对象无法直接存入 Postgres。

**解决**：
- **App 层**：统一用 `Date` 对象
- **DB 层**：存储用 ISO string（`TIMESTAMPTZ`）
- **转换函数**：`toISOString()` 和 `new Date()` 在 `lib/db.ts` 中处理

## 组件通信模式

### 方式 1：通过 Store（推荐）

```typescript
// ComponentA 修改数据
function ComponentA() {
  const addFeed = useRSSStore(state => state.addFeed)
  return <button onClick={() => addFeed(...)}>Add</button>
}

// ComponentB 读取数据
function ComponentB() {
  const feeds = useRSSStore(state => state.feeds)
  return <div>{feeds.length} feeds</div>
}
```

### 方式 2：通过 Props（子组件）

```typescript
function Parent() {
  const feeds = useRSSStore(state => state.feeds)
  return <Child feeds={feeds} />
}

function Child({ feeds }) {
  return <div>{feeds.map(...)}</div>
}
```

### 方式 3：自定义事件（特殊情况）

只在一个地方用到：刷新所有 Feed。

```typescript
// 发送事件
document.dispatchEvent(new CustomEvent("refresh-feeds"))

// 监听事件
useEffect(() => {
  const handler = () => { /* 刷新逻辑 */ }
  document.addEventListener("refresh-feeds", handler)
  return () => document.removeEventListener("refresh-feeds", handler)
}, [])
```

**注意**：这是例外，不是常规做法。能用 Store 就用 Store。

## 下一步

- 查看 [数据流详解](./04-data-flow.md) 了解具体的数据流动
- 查看 [文件结构](./03-file-structure.md) 了解每个文件的职责