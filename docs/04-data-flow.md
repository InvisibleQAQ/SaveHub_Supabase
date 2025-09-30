# 数据流详解

## 核心数据流场景

### 场景 1：添加订阅源

**用户视角**：点击 "Add Feed"，输入 URL，点击确认。

**系统内部流程**：

```
1. 用户在 add-feed-dialog.tsx 输入 URL
   ↓
2. 点击 Add 按钮，触发 handleSubmit
   ↓
3. 调用 validateRSSUrl(url)
   └─→ 发送 POST /api/rss/validate
       └─→ 尝试解析 URL，返回 true/false
   ↓
4. 如果验证通过，调用 parseRSSFeed(url, feedId)
   └─→ 发送 POST /api/rss/parse
       └─→ 服务端用 rss-parser 抓取
       └─→ 返回 { feed: {...}, articles: [...] }
   ↓
5. 调用 useRSSStore.addFeed(feed)
   └─→ store.feeds.push(newFeed)
   └─→ 调用 syncToSupabase()
       └─→ dbManager.saveFeeds([...feeds])
           └─→ supabase.from('feeds').upsert(...)
   ↓
6. 调用 useRSSStore.addArticles(articles)
   └─→ 去重：过滤已存在的 article.id
   └─→ store.articles.push(...newArticles)
   └─→ 直接调用 dbManager.saveArticles(newArticles)
       └─→ supabase.from('articles').upsert(...)
   ↓
7. Zustand 触发重新渲染
   └─→ Sidebar 显示新 Feed
   └─→ ArticleList 显示新文章
```

**关键点**：
- `addFeed` 调用 `syncToSupabase()`（同步整个 feeds 数组）
- `addArticles` 直接调用 `dbManager.saveArticles()`（性能优化，只保存新文章）

---

### 场景 2：标记文章已读

**用户视角**：点击文章查看内容。

**系统内部流程**：

```
1. 用户在 article-list.tsx 点击文章
   ↓
2. 调用 useRSSStore.setSelectedArticle(articleId)
   ↓
3. setSelectedArticle 内部逻辑：
   ├─ store.selectedArticleId = articleId
   └─ 调用 markAsRead(articleId)
       ↓
       ├─ store.articles 中找到该文章
       ├─ 设置 article.isRead = true
       └─ 调用 dbManager.updateArticle(articleId, { isRead: true })
           └─→ supabase.from('articles').update({ is_read: true }).eq('id', articleId)
   ↓
4. Zustand 触发重新渲染
   └─→ ArticleList 中该文章图标变化（已读样式）
   └─→ Sidebar 中 Feed 的未读数减 1
```

**注意**：
- 读操作触发写操作（UX 优化：查看即已读）
- 只更新单篇文章，不同步整个 articles 数组（性能）

---

### 场景 3：收藏文章

**用户视角**：点击文章详情页的星标按钮。

**系统内部流程**：

```
1. 用户在 article-content.tsx 点击星标
   ↓
2. 调用 useRSSStore.toggleStar(articleId)
   ↓
3. toggleStar 逻辑：
   ├─ 找到文章，读取当前 isStarred 状态
   ├─ 翻转状态：isStarred = !isStarred
   ├─ 更新 store.articles
   └─ 调用 dbManager.updateArticle(articleId, { isStarred: newValue })
       └─→ supabase.from('articles').update({ is_starred: newValue }).eq('id', articleId)
   ↓
4. UI 重新渲染
   └─→ 星标图标填充/取消填充
   └─→ 如果在 "Starred" 视图，未收藏的文章从列表消失
```

---

### 场景 4：删除订阅源

**用户视角**：右键 Feed，选择 Delete。

**系统内部流程**：

```
1. 用户确认删除
   ↓
2. 调用 useRSSStore.removeFeed(feedId)
   ↓
3. removeFeed 逻辑：
   ├─ 从 store.feeds 移除该 Feed
   ├─ 从 store.articles 移除该 Feed 的所有文章
   ├─ 如果当前选中的是该 Feed，清空 selectedFeedId
   └─ 调用 dbManager.deleteFeed(feedId)
       └─→ supabase.from('feeds').delete().eq('id', feedId)
           └─→ Postgres CASCADE 删除：自动删除关联的 articles
   ↓
4. UI 更新
   └─→ Sidebar 中 Feed 消失
   └─→ ArticleList 清空（如果正在查看该 Feed）
```

**关键**：数据库外键 `ON DELETE CASCADE` 自动删除关联文章，不需要手动删。

---

### 场景 5：实时同步（多设备）

**场景**：用户在手机添加文章，桌面浏览器自动显示。

**系统内部流程**：

```
设备 A（手机）：
1. 用户添加 Feed
   ↓
2. store.addFeed(feed) → dbManager.saveFeeds()
   ↓
3. Supabase 数据库插入新行

---

设备 B（桌面）：
1. use-realtime-sync.ts 监听 Realtime 频道
   ↓
2. 收到 "feeds" 表的 INSERT 事件
   ↓
3. 调用 subscribeToFeeds 的 onInsert 回调
   ↓
4. 回调函数逻辑：
   ├─ 将数据库行转换为 Feed 对象
   ├─ 调用 store.addFeed(feed)（但跳过 syncToSupabase）
   └─ 可能需要加载该 Feed 的文章
   ↓
5. UI 自动更新
   └─→ Sidebar 显示新 Feed
```

**关键点**：
- Realtime 回调中**不要**再调用 `syncToSupabase()`，会造成死循环
- 需要区分"本地操作"和"远程同步"

**当前实现**：
目前 `use-realtime-sync.ts` 只打印日志，没有自动更新 store。这是简化实现，生产环境应该完善。

**完整实现示例**：
```typescript
realtimeManager.subscribeToFeeds(
  (feed) => {
    // INSERT 事件
    const feedObj = dbRowToFeed(feed)
    // 直接修改 store，不调用 addFeed（避免递归同步）
    useRSSStore.setState(state => ({
      feeds: [...state.feeds.filter(f => f.id !== feedObj.id), feedObj]
    }))
  },
  (feed) => {
    // UPDATE 事件
    // 同上
  },
  (id) => {
    // DELETE 事件
    useRSSStore.setState(state => ({
      feeds: state.feeds.filter(f => f.id !== id)
    }))
  }
)
```

---

### 场景 6：应用启动加载数据

**用户视角**：打开应用，看到之前添加的 Feeds 和文章。

**系统内部流程**：

```
1. App 启动，rss-reader.tsx 渲染
   ↓
2. useEffect 1：检查数据库状态
   └─→ 调用 checkDatabaseStatus()
       └─→ dbManager.isDatabaseInitialized()
           └─→ 尝试查询 settings 表
           └─→ 如果失败 → isDatabaseReady = false
           └─→ 如果成功 → isDatabaseReady = true
   ↓
3. 如果 isDatabaseReady = false
   └─→ 渲染 DatabaseSetup 组件
   └─→ 等待用户运行 SQL 脚本
   └─→ STOP
   ↓
4. 如果 isDatabaseReady = true，useEffect 2：加载数据
   └─→ 调用 loadFromSupabase()
       └─→ Promise.all([
             dbManager.loadFolders(),
             dbManager.loadFeeds(),
             dbManager.loadArticles(),
             dbManager.loadSettings()
           ])
       └─→ 转换数据库行为应用对象
       └─→ 填充 store: { folders, feeds, articles, settings }
       └─→ 调用 clearOldArticles(retentionDays)
           └─→ 删除过期文章
   ↓
5. useEffect 3：订阅 Realtime
   └─→ use-realtime-sync.ts 调用 realtimeManager.subscribeToFeeds/Articles/Folders
   ↓
6. 渲染主界面
   └─→ Sidebar 显示 Feeds
   └─→ ArticleList 显示文章
```

**性能优化点**：
- 使用 `Promise.all` 并发加载，不串行
- Articles 可以考虑分页加载（目前一次性加载所有）

---

### 场景 7：刷新订阅源

**用户视角**：点击 Feed 右键菜单的 "Refresh"。

**系统内部流程**：

```
1. 用户点击 Refresh
   ↓
2. 调用 parseRSSFeed(feed.url, feed.id)
   ↓
3. 获取最新文章列表
   ↓
4. 调用 store.addArticles(articles)
   ├─ 去重逻辑：
   │  ├─ 提取现有文章的 id Set
   │  └─ 过滤掉已存在的文章
   ├─ 只保存新文章
   └─ dbManager.saveArticles(newArticles)
   ↓
5. 更新 feed.lastFetched 时间戳
   └─→ store.updateFeed(feedId, { lastFetched: new Date() })
   ↓
6. UI 更新
   └─→ ArticleList 显示新文章
   └─→ Feed 的 lastFetched 显示"刚刚"
```

**去重算法**：
```typescript
const existingIds = new Set(store.articles.map(a => a.id))
const newArticles = articles.filter(a => !existingIds.has(a.id))
```

**为什么需要去重**：
- RSS 源可能重复返回已抓取的文章
- 避免数据库主键冲突
- 节省存储空间

---

### 场景 8：拖拽 Feed 重组

**用户视角**：拖动 Feed 到不同位置，调整订阅列表结构。

**系统内部流程**：

```
1. 用户开始拖动 Feed
   ↓
2. FeedItem 触发 onDragStart(feedId)
   ↓
3. ExpandedView 设置 draggedFeedId = feedId
   └─→ UI 显示半透明效果（isDragging = true）
   ↓
4. 用户拖到目标位置（另一个 Feed 或 Folder 上）
   ↓
5. 目标组件触发 onDragOver（显示可放置提示）
   ↓
6. 用户松开鼠标，触发 onDrop
   ↓
7. 根据 drop 目标类型，计算新的位置：
   ├─ 拖到 Feed 上：
   │  ├─ 找到目标 Feed 的 folderId 和 order
   │  └─ 调用 moveFeed(draggedFeedId, targetFolderId, targetIndex)
   │
   ├─ 拖到 Folder 上：
   │  └─ 调用 moveFeed(draggedFeedId, folderId, 0)
   │      └─→ 插入到该 Folder 的第一个位置
   │
   └─ 拖到 Root Level drop zone：
      └─ 调用 moveFeed(draggedFeedId, undefined, rootLevelFeeds.length)
          └─→ 移出所有 Folder，添加到根级别末尾
   ↓
8. store.moveFeed 内部逻辑：
   ├─ 更新被拖动 Feed 的 folderId
   ├─ 获取目标 folder（或 root）内的所有 Feed
   ├─ 在目标位置插入被拖动的 Feed
   ├─ 重新分配所有 Feed 的 order（0, 1, 2, ...）
   ├─ 如果跨 folder 移动，也重排源 folder 的 order
   └─ 调用 syncToSupabase() 批量保存
   ↓
9. UI 自动更新
   └─→ Sidebar 中 Feed 显示在新位置
```

**关键实现细节**：

**拖拽状态管理**：
```typescript
const [draggedFeedId, setDraggedFeedId] = useState<string | null>(null)

// 拖动开始
const handleFeedDragStart = (feedId: string) => {
  setDraggedFeedId(feedId)
}

// 拖动结束
const handleFeedDrop = (e: React.DragEvent, targetFeedId: string) => {
  // 计算新位置
  moveFeed(draggedFeedId, targetFolderId, targetIndex)
  setDraggedFeedId(null)  // 清除拖拽状态
}
```

**order 重排算法**：
```typescript
// 同一 folder 内的 Feed，按 order 排序
const sameFolderFeeds = feeds
  .filter(f => f.folderId === targetFolderId)
  .sort((a, b) => a.order - b.order)

// 移除被拖动的 Feed
const otherFeeds = sameFolderFeeds.filter(f => f.id !== draggedFeedId)

// 在目标位置插入
otherFeeds.splice(targetIndex, 0, draggedFeed)

// 重新分配 order
const reorderedFeeds = otherFeeds.map((f, index) => ({ ...f, order: index }))
```

**跨 Folder 移动处理**：
```typescript
if (oldFolderId !== targetFolderId && oldFolderId !== undefined) {
  // 重排源 folder 的 order
  const oldFolderFeeds = feeds
    .filter(f => f.folderId === oldFolderId)
    .map((f, index) => ({ ...f, order: index }))
}
```

**原生 Drag/Drop API**：
```typescript
// Feed 组件
<div
  draggable
  onDragStart={(e) => onDragStart?.(feed.id)}
  onDragOver={(e) => { e.preventDefault(); onDragOver?.(e, feed.id) }}
  onDrop={(e) => { e.preventDefault(); onDrop?.(e, feed.id) }}
  className={cn(isDragging && "opacity-50")}
>
```

**视觉反馈**：
- 拖动中的 Feed：`opacity-50 cursor-move`
- Root Level drop zone：`border-2 border-dashed` + 提示文字
- Folder drop zone：`onDragOver` 时可添加高亮效果

**性能优化**：
- 使用 `e.stopPropagation()` 避免事件冒泡
- 只在同一层级计算 order，不影响其他 folder
- 批量更新数据库（`syncToSupabase` 一次性保存所有 Feed）

---

## 数据流动原则

### 1. 单向数据流

```
用户操作 → Action → Store 更新 → UI 重新渲染
```

**禁止**：UI 直接修改 store 数据，必须通过 actions。

### 2. Store 是唯一数据源

**好**：
```typescript
const feeds = useRSSStore(state => state.feeds)
```

**坏**：
```typescript
const [feeds, setFeeds] = useState([])  // 不要在组件里维护状态副本
useEffect(() => {
  dbManager.loadFeeds().then(setFeeds)  // 不要直接查数据库
}, [])
```

### 3. 数据库操作由 Store Actions 调用

**好**：
```typescript
const removeFeed = useRSSStore(state => state.removeFeed)
removeFeed(feedId)  // Action 内部会调用 dbManager
```

**坏**：
```typescript
dbManager.deleteFeed(feedId)  // 组件不要直接调用
```

### 4. Realtime 更新不触发同步

Realtime 回调函数应该：
- 直接修改 store（`setState`）
- **不调用** `syncToSupabase()`
- **不调用** store actions（会触发同步）

### 5. 乐观更新 + 异步持久化

```typescript
// 立即更新 UI
set(state => ({ articles: [...state.articles, newArticle] }))

// 异步保存数据库（不阻塞 UI）
dbManager.saveArticles([newArticle]).catch(console.error)
```

**好处**：UI 响应快，用户体验好。

**风险**：如果数据库保存失败，数据不一致。

**缓解方案**：
- 显示 Toast 错误通知
- 下次刷新时重新从数据库加载（覆盖错误状态）

---

## 常见数据流问题

### 问题 1：数据不同步

**症状**：修改数据后，其他设备看不到。

**可能原因**：
1. 忘记调用 `syncToSupabase()` 或 `dbManager.save*`
2. Realtime 订阅未启用
3. 网络问题

**调试**：
1. 检查浏览器控制台是否有错误
2. 打开 Supabase Dashboard → Table Editor，手动查看数据
3. 检查 `use-realtime-sync.ts` 是否有日志输出

### 问题 2：数据重复

**症状**：同一篇文章显示多次。

**可能原因**：
1. `addArticles` 去重逻辑失效
2. 文章 ID 生成不唯一

**调试**：
```typescript
console.log('Existing IDs:', store.articles.map(a => a.id))
console.log('New IDs:', articles.map(a => a.id))
console.log('Duplicates:', articles.filter(a => existingIds.has(a.id)))
```

### 问题 3：UI 不更新

**症状**：修改数据后，界面没反应。

**可能原因**：
1. 组件没有订阅对应的 store 状态
2. 数据修改没有通过 Zustand `set` 方法

**调试**：
```typescript
// 检查是否订阅
const feeds = useRSSStore(state => state.feeds)
console.log('Feeds:', feeds)

// 检查 store 是否真的更新了
console.log(useRSSStore.getState().feeds)
```

### 问题 4：性能问题

**症状**：文章很多时，滚动卡顿。

**优化方向**：
1. 虚拟滚动（react-window 或 react-virtuoso）
2. 分页加载文章
3. 减少 re-render（useMemo、useCallback）
4. 细粒度订阅 store

---

## 下一步

- 查看 [开发指南](./05-development-guide.md) 学习如何修改代码
- 查看 [常见任务](./06-common-tasks.md) 了解具体开发场景