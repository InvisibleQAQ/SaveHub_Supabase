# 故障排查指南

本文档帮助你快速定位和解决开发中的常见问题。

---

## 数据库相关问题

### 问题 1：页面显示 "Database not initialized"

**症状**：应用启动后，一直显示数据库未初始化页面。

**原因**：
1. 你没有运行 SQL 初始化脚本
2. Supabase 项目不存在或无法访问
3. 环境变量配置错误

**解决步骤**：

1. **确认环境变量正确**：

检查 `.env` 文件：

```bash
cat .env
```

应该看到：

```
NEXT_PUBLIC_SUPABASE_URL=https://xxhlzzntzrdktyzkjpxu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...（很长的字符串）
```

如果不对，去 Supabase Dashboard → Settings → API 复制正确的值。

2. **确认 Supabase 项目可访问**：

在浏览器打开 `https://xxhlzzntzrdktyzkjpxu.supabase.co`，应该看到项目页面。

3. **运行 SQL 脚本**：

- 打开 Supabase Dashboard → SQL Editor
- 复制 `scripts/001_create_tables.sql` 的全部内容
- 粘贴到 SQL Editor
- 点击 "Run"

4. **验证表已创建**：

Supabase Dashboard → Table Editor，应该看到 4 张表：folders、feeds、articles、settings。

5. **重启开发服务器**：

```bash
# Ctrl+C 停止
pnpm dev  # 重新启动
```

6. **如果还不行，检查浏览器控制台**：

按 F12 打开控制台，查看是否有错误信息。常见错误：

- `Invalid API key`：anon key 错误，重新复制
- `Failed to fetch`：网络问题或 Supabase 服务不可用

---

### 问题 2：数据不保存到数据库

**症状**：添加 Feed 或文章后，刷新页面数据消失。

**可能原因**：
1. `syncToSupabase()` 未调用
2. 数据库写入失败但没有报错
3. 环境变量错误（使用了错误的 Supabase 项目）

**调试步骤**：

1. **检查控制台错误**：

打开浏览器控制台（F12），执行操作，看是否有报错。

**常见错误：NOT NULL 约束违规**

如果看到类似错误：

```
code: "23502"
message: "null value in column \"order\" of relation \"feeds\" violates not-null constraint"
```

**原因**：数据库要求某些字段必须有值（如 `order`、`unreadCount`），但代码传了 `null` 或 `undefined`。

**解决**：确保 `addFeed()` 和 `addFolder()` 自动设置这些字段：

```typescript
// lib/store.ts
addFeed: (feed) => {
  const state = get()
  const sameFolderFeeds = state.feeds.filter(f => (f.folderId || undefined) === (feed.folderId || undefined))
  const maxOrder = sameFolderFeeds.reduce((max, f) => Math.max(max, f.order ?? -1), -1)

  const newFeed: Feed = {
    id: feed.id || crypto.randomUUID(),
    order: maxOrder + 1,        // 自动计算 order
    unreadCount: 0,             // 默认值 0
    ...feed,
  }
  // ...
}
```

并在 `lib/db/feeds.ts` 中使用 `??` 运算符作为最后防线：

```typescript
function feedToDb(feed: Feed): DbRow {
  return {
    id: feed.id,
    title: feed.title,
    url: feed.url,
    order: feed.order ?? 0,              // 确保非空
    unread_count: feed.unreadCount ?? 0, // 确保非空
    // ...
  }
}
```

**如果仍有类似错误**：

1. 检查错误消息中的字段名（`column "xxx"`）
2. 在 Supabase Dashboard → Table Editor 查看该字段是否有 NOT NULL 约束
3. 在代码中搜索创建该类型对象的位置，确保该字段有值

2. **手动测试数据库连接**：

在浏览器控制台运行：

```javascript
const { createClient } = await import('./lib/supabase/client')
const supabase = createClient()

const { data, error } = await supabase.from('feeds').select('*')
console.log({ data, error })
```

如果返回 `error`，说明数据库连接有问题。

3. **确认 action 调用了持久化方法**：

在 `lib/store.ts` 的 action 中添加日志：

```typescript
addFeed: (feed) => {
  console.log('[Store] Adding feed:', feed)

  set((state) => ({
    feeds: [...state.feeds, newFeed],
  }))

  console.log('[Store] Syncing to Supabase...')
  get().syncToSupabase()
},
```

如果看不到 "Syncing to Supabase..." 日志，说明代码执行不到这里。

4. **检查 Supabase Dashboard**：

打开 Table Editor → feeds 表，手动查看数据是否写入。

5. **检查 RLS 策略**（Row Level Security）：

Supabase 默认启用 RLS，可能阻止写入。临时关闭测试：

```sql
-- 在 SQL Editor 运行
ALTER TABLE feeds DISABLE ROW LEVEL SECURITY;
ALTER TABLE articles DISABLE ROW LEVEL SECURITY;
ALTER TABLE folders DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
```

**注意**：生产环境应该启用 RLS 并配置正确的策略。

---

### 问题 3：Realtime 更新不工作

**症状**：在一个设备修改数据，另一个设备不自动更新。

**可能原因**：
1. Realtime 订阅未启用
2. Supabase Realtime 功能未开启
3. 回调函数没有更新 store

**解决步骤**：

1. **确认 Realtime 已启用**：

检查 Supabase Dashboard → Settings → API → Realtime，确保 "Enable Realtime" 开关打开。

2. **检查订阅状态**：

在 `hooks/use-realtime-sync.ts` 中添加日志：

```typescript
export function useRealtimeSync() {
  useEffect(() => {
    const channel = realtimeManager.subscribeToFeeds(...)
    console.log('[Realtime] Channel state:', channel.state)  // 应该是 "joined"

    return () => {
      realtimeManager.unsubscribeAll()
    }
  }, [])
}
```

3. **测试手动触发事件**：

在 Supabase SQL Editor 手动插入数据：

```sql
INSERT INTO feeds (id, title, url, unread_count)
VALUES (gen_random_uuid(), 'Test Feed', 'https://example.com/feed.xml', 0);
```

如果浏览器控制台没有看到 Realtime 日志，说明订阅未生效。

4. **检查回调函数**：

在 `lib/realtime.ts` 中确认回调有日志：

```typescript
.on("postgres_changes", { event: "INSERT", schema: "public", table: "feeds" }, (payload) => {
  console.log("[Realtime] Feed inserted:", payload.new)  // 应该有这行
  onInsert?.(payload.new as FeedRow)
})
```

5. **完善回调逻辑**（当前未实现）：

目前回调只打印日志，需要更新 store：

```typescript
// 在 use-realtime-sync.ts 中
realtimeManager.subscribeToFeeds(
  (feed) => {
    // INSERT 事件
    const feedObj = dbRowToFeed(feed)
    useRSSStore.setState(state => ({
      feeds: [...state.feeds.filter(f => f.id !== feedObj.id), feedObj]
    }))
  },
  // ... UPDATE 和 DELETE 回调
)
```

---

## RSS 抓取问题

### 问题 4：添加 Feed 失败，提示 "Failed to parse RSS feed"

**可能原因**：
1. URL 不是有效的 RSS 源
2. RSS 源需要认证
3. CORS 问题（但我们用服务端 API，一般不会有）
4. RSS 源返回格式不标准

**解决步骤**：

1. **验证 URL**：

在浏览器直接打开 RSS URL，应该看到 XML 内容：

```xml
<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>...</title>
    <item>...</item>
  </channel>
</rss>
```

2. **查看服务端日志**：

在运行 `pnpm dev` 的终端查看错误信息。在 `app/api/rss/parse/route.ts` 添加日志：

```typescript
export async function POST(request: NextRequest) {
  try {
    const { url, feedId } = await request.json()
    console.log('[API] Parsing RSS:', url)

    const parser = new Parser()
    const feed = await parser.parseURL(url)

    console.log('[API] Parsed:', feed.title, feed.items.length, 'items')

    // ...
  } catch (error) {
    console.error('[API] Parse error:', error)  // 关键日志
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
```

3. **测试 RSS Parser**：

直接在 Node.js 环境测试：

```javascript
// 创建测试文件 test-rss.js
const Parser = require('rss-parser')

async function test() {
  const parser = new Parser()
  const feed = await parser.parseURL('你的RSS URL')
  console.log(feed.title, feed.items.length)
}

test()
```

运行：

```bash
node test-rss.js
```

4. **使用 RSS 发现功能**：

如果用户输入的是网站首页，尝试自动发现 RSS：

```typescript
// 在 add-feed-dialog.tsx 中
const possibleFeeds = discoverRSSFeeds(url)

for (const feedUrl of possibleFeeds) {
  try {
    const valid = await validateRSSUrl(feedUrl)
    if (valid) {
      // 使用这个 URL
      break
    }
  } catch {}
}
```

---

### 问题 5：RSS 抓取很慢

**症状**：添加 Feed 或刷新 Feed 需要等很久。

**原因**：RSS 源服务器响应慢，或者 `rss-parser` 超时设置不合理。

**优化方法**：

1. **添加超时设置**（`app/api/rss/parse/route.ts`）：

```typescript
import Parser from "rss-parser"

const parser = new Parser({
  timeout: 10000,  // 10 秒超时
})
```

2. **使用 Loading 状态**：

在 UI 中显示加载动画，用户体验更好：

```typescript
const [isLoading, setIsLoading] = useState(false)

const handleAdd = async () => {
  setIsLoading(true)
  try {
    await parseRSSFeed(url, feedId)
    toast.success("添加成功")
  } catch (error) {
    toast.error("添加失败")
  } finally {
    setIsLoading(false)
  }
}
```

3. **批量刷新优化**：

刷新所有 Feeds 时，并发限制：

```typescript
async function refreshAllFeeds() {
  const feeds = useRSSStore.getState().feeds

  // 每次最多刷新 3 个
  for (let i = 0; i < feeds.length; i += 3) {
    const batch = feeds.slice(i, i + 3)
    await Promise.all(batch.map(feed => refreshFeed(feed.id)))
  }
}
```

---

## UI 渲染问题

### 问题 6：修改数据后 UI 不更新

**症状**：调用 store action 后，界面没有变化。

**可能原因**：
1. 组件没有订阅对应的 store 状态
2. 直接修改了对象/数组，Zustand 检测不到变化
3. React 渲染批处理导致延迟

**解决步骤**：

1. **确认组件订阅了状态**：

```typescript
// ❌ 错误：没有订阅
function MyComponent() {
  const store = useRSSStore()  // 订阅了整个 store，但不会触发重新渲染
  return <div>{store.feeds.length}</div>
}

// ✅ 正确：订阅特定字段
function MyComponent() {
  const feeds = useRSSStore(state => state.feeds)  // 只在 feeds 变化时重新渲染
  return <div>{feeds.length}</div>
}
```

2. **检查是否直接修改了状态**：

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

3. **强制重新渲染**（临时调试）：

```typescript
const [, forceUpdate] = useReducer(x => x + 1, 0)

// 在 action 后调用
forceUpdate()
```

4. **使用 React DevTools**：

安装 React Developer Tools 扩展，查看组件树和 props/state，确认数据是否更新。

---

### 问题 7：列表滚动卡顿（大量文章时）

**症状**：文章超过几百篇时，滚动列表很卡。

**原因**：渲染了所有文章的 DOM 节点，性能瓶颈。

**解决方案：虚拟滚动**

1. **安装 react-window**：

```bash
pnpm add react-window
```

2. **改造文章列表**（`components/article-list.tsx`）：

```typescript
import { FixedSizeList } from "react-window"

export function ArticleList() {
  const filteredArticles = useRSSStore(state => state.getFilteredArticles())

  return (
    <FixedSizeList
      height={600}  // 列表高度
      itemCount={filteredArticles.length}
      itemSize={80}  // 每项高度
      width="100%"
    >
      {({ index, style }) => (
        <div style={style}>
          <ArticleItem article={filteredArticles[index]} />
        </div>
      )}
    </FixedSizeList>
  )
}
```

**效果**：只渲染可见区域的文章，性能提升 10 倍以上。

---

## TypeScript 类型问题

### 问题 8：类型错误 "Property does not exist"

**症状**：编辑器报红线，提示属性不存在。

**常见场景**：

1. **数据库类型未同步**：

添加了新字段，但 `lib/supabase/types.ts` 未更新。

**解决**：手动更新类型，或使用 Supabase CLI 生成：

```bash
supabase gen types typescript --project-id xxhlzzntzrdktyzkjpxu > lib/supabase/types.ts
```

2. **Zod schema 未更新**：

`lib/types.ts` 中的 schema 和实际数据不匹配。

**解决**：同步更新 schema：

```typescript
export const ArticleSchema = z.object({
  // 添加新字段
  newField: z.string().optional(),
})
```

3. **类型断言错误**：

```typescript
// ❌ 错误
const feed = data as Feed  // 如果 data 结构不对，运行时会出错

// ✅ 正确
const feed = FeedSchema.parse(data)  // Zod 会验证，不匹配会抛错
```

---

### 问题 9：环境变量类型错误

**症状**：`process.env.NEXT_PUBLIC_SUPABASE_URL` 提示可能是 undefined。

**解决**：使用类型断言 `!` 或提供默认值：

```typescript
// 方法 1：非空断言（确信环境变量存在）
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!

// 方法 2：默认值
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://default.supabase.co"

// 方法 3：运行时检查
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL")
}
```

---

## 构建和部署问题

### 问题 10：pnpm build 失败

**症状**：运行 `pnpm build` 报错，无法构建生产版本。

**常见错误**：

1. **类型错误**：

```
Type error: Property 'xxx' does not exist on type 'yyy'
```

**解决**：修复类型定义，或临时禁用类型检查（不推荐）：

```json
// next.config.mjs
export default {
  typescript: {
    ignoreBuildErrors: true,  // 临时跳过类型检查
  },
}
```

2. **未使用的变量**：

```
'variable' is assigned a value but never used
```

**解决**：删除未使用的变量，或用 `_` 前缀忽略：

```typescript
const _unused = something
```

3. **模块解析错误**：

```
Module not found: Can't resolve '@/lib/store'
```

**解决**：检查 `tsconfig.json` 的 paths 配置：

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

---

## 性能优化

### 问题 11：应用启动很慢

**原因**：首次加载大量文章数据。

**优化方案**：

1. **分页加载文章**：

```typescript
async loadArticles(feedId?: string, limit = 50): Promise<Article[]> {
  const supabase = createClient()

  let query = supabase
    .from("articles")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(limit)  // 只加载最新 50 篇

  if (feedId) {
    query = query.eq("feed_id", feedId)
  }

  const { data, error } = await query
  if (error) throw error

  return (data || []).map(dbRowToArticle)
}
```

2. **延迟加载非关键数据**：

```typescript
useEffect(() => {
  // 先加载 Feeds
  loadFeeds()

  // 延迟加载文章
  setTimeout(() => {
    loadArticles()
  }, 1000)
}, [])
```

3. **使用 React Suspense**（Next.js 14）：

```typescript
import { Suspense } from "react"

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ArticleList />
    </Suspense>
  )
}
```

---

## 调试工具

### 使用数据库操作日志

项目已内置详细的数据库操作日志，帮助快速定位问题：

**启用日志**：代码已默认启用，打开浏览器控制台（F12）即可查看。

**日志格式**：

```
[Supabase Client] Initializing with URL: https://xxxx.supabase.co
[DB] Saving 1 items to feeds
[DB] Successfully saved 1 items to feeds
[DB] Updating article abc123 with: { is_read: true }
[DB] Successfully updated article
[DB] Deleting item xyz789 from feeds
[DB] Successfully deleted from feeds
```

**查错示例**：

如果添加 Feed 失败，你会看到：

```
[DB] Saving 1 items to feeds
[DB] Failed to save to feeds: {
  code: "23502",
  message: "null value in column \"order\" violates not-null constraint"
}
```

**环境变量检测**：

如果 Supabase 环境变量缺失，你会立即看到：

```
[Supabase Client] Missing environment variables: {
  url: 'MISSING',
  key: 'SET'
}
Error: Missing Supabase environment variables. Check .env file.
```

**临时禁用日志**（生产环境）：

搜索并注释掉 `console.log` 和 `console.error`：

```typescript
// console.log(`[DB] Saving ${items.length} items to ${this.tableName}`)
```

### 浏览器 DevTools 技巧

1. **查看 Zustand Store**：

```javascript
// 在控制台运行
window.useRSSStore = (await import('./lib/store')).useRSSStore
console.log(window.useRSSStore.getState())
```

2. **查看 Supabase 实时连接**：

```javascript
// 在控制台运行
const { createClient } = await import('./lib/supabase/client')
const supabase = createClient()
console.log(supabase.getChannels())  // 查看所有 Realtime channels
```

3. **React Profiler**：

React DevTools → Profiler → 录制，查看组件渲染性能。

---

## 获取帮助

如果以上方法都解决不了问题：

1. **检查浏览器控制台错误**（F12）
2. **检查服务端日志**（运行 `pnpm dev` 的终端）
3. **查看 Supabase Dashboard 日志**（Logs → Postgres Logs）
4. **简化问题**：注释掉代码，逐步定位问题位置
5. **搜索错误信息**：复制错误消息到 Google/StackOverflow

---

## 已修复的已知问题 ⚠️ **更新**

### 问题 1: API Config 删除 Race Condition ✅ **已修复** (commit 80d9a8f)

**症状**: 删除 API 配置后,UI 显示已删除,但数据库中仍然存在。

**原因**: 使用了乐观更新模式 (先更新 store,再删除 DB),如果 DB 删除失败,store 和 DB 不一致。

**修复**: 改为悲观删除模式:
1. 先从数据库删除
2. 如果删除成功,再更新 store
3. 如果删除失败,抛出错误,store 不变

**代码位置**: `lib/store/api-configs.slice.ts:deleteApiConfig()`

**相关日志**:
```typescript
// 现在可以在日志中看到删除操作的完整追踪
logger.debug({ configId, userId }, 'Deleting API config from database')
// ... DB 操作 ...
logger.info({ configId, userId }, 'API config deleted from store')
// 或
logger.error({ error, configId, userId }, 'Failed to delete API config from database')
```

### 问题 2: Legacy API Config 迁移失败无感知 ⚠️ **部分修复** (commit 80d9a8f)

**症状**: 旧版未加密的 API 配置迁移失败时无任何提示。

**修复**: 现在迁移失败会记录到结构化日志中:
```typescript
logger.error({ error: migrationError, configId, userId }, 'Legacy config auto-migration failed')
```

**仍存在的问题**: 没有重试机制,迁移失败后不会再次尝试。

**查看迁移日志**:
```bash
pnpm dev 2>&1 | grep "migration"
# 或查看特定配置的迁移状态
pnpm dev 2>&1 | jq 'select(.configId=="abc123") | select(.msg | contains("migration"))'
```

---

## 日志相关问题 ⚠️ **新增**

### 问题 3: 看不到日志输出

**症状**: 终端运行 `pnpm dev` 后,看不到任何 Pino 日志输出。

**可能原因**:
1. **日志等级过高**: 生产环境只显示 `info` 及以上,开发环境显示 `debug` 及以上
2. **输出被 Next.js 日志淹没**: Next.js 自身也有大量日志

**解决步骤**:

1. **确认环境变量**:
```bash
echo $NODE_ENV  # 应该是 'development'
```

2. **过滤 Pino JSON 日志**:
```bash
pnpm dev 2>&1 | grep '"level"'  # 只看结构化日志
pnpm dev 2>&1 | grep '"level":"ERROR"'  # 只看错误
```

3. **使用 jq 美化输出**:
```bash
# 安装 jq: brew install jq (macOS) 或 apt install jq (Linux)
pnpm dev 2>&1 | grep '"level"' | jq .
```

4. **临时降低日志等级** (调试用):

在 `lib/logger.ts` 中:
```typescript
export const logger = pino({
  level: 'trace',  // 临时改为 trace (最低等级)
  // ...
})
```

### 问题 4: 敏感信息泄露到日志

**症状**: API key 或 password 出现在日志输出中。

**原因**: 使用了未被自动脱敏的字段名。

**自动脱敏的字段** (大小写不敏感):
- `apiKey`, `api_key`
- `password`
- `token`, `secret`
- `ENCRYPTION_SECRET`
- 嵌套对象中的同名字段 (`*.apiKey`)

**解决**:

1. **检查字段名**: 确保敏感字段使用上述命名
2. **如果必须使用其他名字,手动脱敏**:
```typescript
logger.info({
  customSecretField: '***REDACTED***',  // 手动脱敏
  userId: 'abc'
}, 'Operation completed')
```

3. **添加新的脱敏规则** (在 `lib/logger.ts`):
```typescript
redact: {
  paths: [
    'apiKey', 'api_key', 'password', 'token', 'secret',
    'customSecretField',  // 新增自定义字段
    '*.customSecretField',  // 嵌套对象中也脱敏
  ],
  censor: '***REDACTED***'
}
```

### 问题 5: 日志显示 `[object Object]`

**症状**: 日志输出类似 `{"msg":"Data saved","result":"[object Object]"}`

**原因**: 将对象转为字符串后传入日志,丢失了结构信息。

**错误示例**:
```typescript
const data = { id: 'abc', name: 'test' }
logger.info({ result: data.toString() }, 'Data saved')  // ❌ 错误
logger.info({ result: `Data: ${data}` }, 'Data saved')  // ❌ 错误
```

**正确做法**:
```typescript
const data = { id: 'abc', name: 'test' }
logger.info({ result: data }, 'Data saved')  // ✅ 正确 - 直接传对象
logger.info({ dataId: data.id, dataName: data.name }, 'Data saved')  // ✅ 正确 - 拆解字段
```

---

## 常用调试代码片段

```typescript
// ⚠️ 注意:调试完成后请移除这些 console.log,改用 logger.*

// 1. 打印 Store 状态
console.log('[Debug] Store state:', useRSSStore.getState())

// 2. 打印组件 props
console.log('[Debug] Props:', { articleId, isRead, ... })

// 3. 测试数据库查询
import { logger } from "@/lib/logger"  // ✅ 使用 logger 替代 console.log

logger.debug({ table: 'feeds', operation: 'test_query' }, 'Testing database query')
const { data, error } = await supabase.from('feeds').select('*')
if (error) {
  logger.error({ error, table: 'feeds' }, 'Query failed')
} else {
  logger.debug({ resultCount: data.length }, 'Query succeeded')
}

// 4. 测试 Realtime 连接
const channel = supabase.channel('test')
logger.debug({ channelState: channel.state }, 'Testing Realtime connection')

// 5. 测试 RSS 解析
const startTime = Date.now()
const { feed, articles } = await parseRSSFeed('https://...', 'test-id')
const duration = Date.now() - startTime
logger.info({
  feedUrl: 'https://...',
  articleCount: articles.length,
  duration
}, 'RSS parsing test completed')
```

---

**祝你调试顺利！如果遇到新问题，欢迎补充到这个文档。**