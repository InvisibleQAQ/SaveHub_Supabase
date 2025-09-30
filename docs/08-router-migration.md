# 路由架构重构总结

## 变更概述

将单页面状态管理架构迁移到 Next.js 多路由架构，使 URL 成为视图状态的单一真相来源。

## 核心变更

### 1. Store 简化

**移除字段**：
```typescript
// ❌ 已移除
interface RSSReaderState {
  viewMode: "all" | "unread" | "starred"
  selectedFeedId: string | null
}
```

**原因**：这些状态现在由 URL 管理

### 2. 路由结构

**新增路由**：
```
app/
├── page.tsx                 → redirect('/all')
└── (reader)/                # 路由组
    ├── layout.tsx           # 共享布局
    ├── all/page.tsx         # /all
    ├── unread/page.tsx      # /unread
    ├── starred/page.tsx     # /starred
    └── feed/[feedId]/page.tsx  # /feed/:id
```

### 3. 组件接口变更

**ArticleList 组件**：
```typescript
// 旧版本
function ArticleList() {
  const { viewMode, selectedFeedId } = useRSSStore()
  const articles = getFilteredArticles()  // 从 store 读取
}

// 新版本
interface ArticleListProps {
  viewMode?: "all" | "unread" | "starred"
  feedId?: string | null
}

function ArticleList({ viewMode = "all", feedId = null }: ArticleListProps) {
  const articles = getFilteredArticles({ viewMode, feedId })  // 传参
}
```

**Sidebar 组件**：
```typescript
// 旧版本
<Button onClick={() => setViewMode('all')}>All Articles</Button>

// 新版本
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const pathname = usePathname()
<Button asChild>
  <Link href="/all">All Articles</Link>
</Button>
```

**Keyboard Shortcuts**：
```typescript
// 旧版本
case '1':
  setViewMode('all')
  break

// 新版本
import { useRouter } from 'next/navigation'

const router = useRouter()
case '1':
  router.push('/all')
  break
```

### 4. Store Actions 更新

**getFilteredArticles**：
```typescript
// 旧版本
getFilteredArticles: () => {
  const state = get()
  let filtered = state.articles

  if (state.selectedFeedId) {
    filtered = filtered.filter(a => a.feedId === state.selectedFeedId)
  }

  switch (state.viewMode) {
    case 'unread': ...
  }
}

// 新版本
getFilteredArticles: ({ viewMode = "all", feedId = null }) => {
  const state = get()
  let filtered = state.articles

  if (feedId) {
    filtered = filtered.filter(a => a.feedId === feedId)
  }

  switch (viewMode) {
    case 'unread': ...
  }
}
```

### 5. LocalStorage 持久化

**完全移除**：
```typescript
// ❌ 已移除
export const useRSSStore = create<RSSReaderState & RSSReaderActions>()(
  persist(
    (set, get) => ({ ... }),
    {
      name: "rss-reader-storage",
      partialize: (state) => ({
        viewMode: state.viewMode,
        selectedFeedId: state.selectedFeedId,
      }),
    }
  )
)

// ✅ 新版本
export const useRSSStore = create<RSSReaderState & RSSReaderActions>()((set, get) => ({
  // 直接创建，不使用 persist middleware
}))
```

## 优势

### 1. 符合 Web 标准
- ✅ 浏览器前进/后退按钮原生支持
- ✅ URL 可分享、可收藏
- ✅ 刷新页面保持当前视图
- ✅ 多标签页独立状态

### 2. 简化状态管理
- ✅ 减少 Store 复杂度
- ✅ 消除 localStorage 同步问题
- ✅ URL 是单一真相来源
- ✅ 无状态漂移风险

### 3. 更好的用户体验
- ✅ 可以直接访问 `/unread` 链接
- ✅ 可以在未读列表页刷新
- ✅ 可以分享特定 Feed 的链接给他人
- ✅ 浏览器历史记录正确工作

### 4. SEO 友好
- ✅ 每个视图独立 URL
- ✅ 可以为不同路由设置不同元数据
- ✅ 爬虫可以正确索引

## 迁移检查清单

- [x] 移除 `viewMode` 和 `selectedFeedId` 从 `lib/types.ts`
- [x] 移除 `setViewMode` 和 `setSelectedFeed` actions
- [x] 更新 `getFilteredArticles` 接收参数
- [x] 创建路由文件 `/all`, `/unread`, `/starred`, `/feed/[feedId]`
- [x] 创建共享布局 `app/(reader)/layout.tsx`
- [x] 更新 `sidebar.tsx` 使用 `<Link>` 和 `usePathname()`
- [x] 更新 `article-list.tsx` 接收 `viewMode` 和 `feedId` props
- [x] 更新 `keyboard-shortcuts.tsx` 使用 `router.push()`
- [x] 移除 `persist` middleware 从 store
- [x] 移除 `import { persist } from "zustand/middleware"`
- [x] 更新文档

## 破坏性变更

### API 变更

**Store**：
- ❌ `state.viewMode` → 从 URL 读取
- ❌ `state.selectedFeedId` → 从 URL 读取
- ❌ `setViewMode()` → 使用 `router.push()`
- ❌ `setSelectedFeed()` → 使用 `router.push()`
- ✅ `getFilteredArticles({ viewMode, feedId })`（新签名）

**Components**：
- `ArticleList` 现在需要 `viewMode?` 和 `feedId?` props
- `Sidebar` 不再调用 store actions 切换视图
- `KeyboardShortcuts` 需要 `useRouter()` 和 `usePathname()`

### 数据兼容性

**数据库**：无变更，完全兼容

**LocalStorage**：
- 旧的 `rss-reader-storage` key 中的 `viewMode` 和 `selectedFeedId` 会被忽略
- 不需要清理（不影响功能）

## 回滚方案

如果需要回滚到旧架构：

1. 恢复 `lib/types.ts` 中的 `viewMode` 和 `selectedFeedId`
2. 恢复 store actions: `setViewMode`, `setSelectedFeed`
3. 恢复 `getFilteredArticles()` 从 store 读取状态
4. 删除 `app/(reader)/` 路由文件
5. 恢复 `app/page.tsx` 直接渲染 `<RSSReader />`
6. 恢复 `persist` middleware 配置

## 后续优化

### 可选改进

1. **预加载数据**：
   ```typescript
   // 在 layout.tsx 中预加载数据
   export async function generateStaticParams() {
     const feeds = await getFeeds()
     return feeds.map(feed => ({ feedId: feed.id }))
   }
   ```

2. **路由元数据**：
   ```typescript
   // app/(reader)/unread/page.tsx
   export const metadata = {
     title: "Unread Articles - RSS Reader",
     description: "View your unread articles"
   }
   ```

3. **Loading 状态**：
   ```typescript
   // app/(reader)/all/loading.tsx
   export default function Loading() {
     return <ArticleListSkeleton />
   }
   ```

4. **Error 边界**：
   ```typescript
   // app/(reader)/error.tsx
   export default function Error({ error, reset }) {
     return <ErrorBoundary error={error} reset={reset} />
   }
   ```

## 参考资料

- [Next.js App Router 文档](https://nextjs.org/docs/app)
- [URL 作为状态管理](https://remix.run/blog/react-router-v6.4)
- [项目架构文档](./02-architecture.md)
- [数据流指南](./04-data-flow.md)