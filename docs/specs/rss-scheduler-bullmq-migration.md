# RSS 调度器迁移:setTimeout → BullMQ

**状态**: 草稿
**创建日期**: 2025-11-26
**作者**: 系统架构
**决策**: 从纯 `setTimeout` 迁移到 BullMQ + Redis 任务队列

---

## 执行摘要

**问题**: 当前的 RSS 调度器(`lib/scheduler.ts`)在浏览器/客户端运行,当用户关闭浏览器标签页时,feed 停止更新。

**解决方案**: 迁移到使用 BullMQ + Redis 的服务端任务队列。

**为什么选择 BullMQ?**

- ✅ 持久化任务队列(服务器重启后仍存在)
- ✅ 可靠的重试机制
- ✅ 内置监控(Bull Board)
- ✅ 为未来微服务奠定基础(视频下载、字幕解析等)
- ✅ 开源,零供应商锁定
- ✅ 生产就绪(Uber、Netflix 在使用)

---

## 目录

1. [背景与动机](#背景与动机)
2. [需求分析](#需求分析)
3. [架构设计](#架构设计)
4. [实施步骤](#实施步骤)
5. [边缘情况与错误处理](#边缘情况与错误处理)
6. [测试策略](#测试策略)
7. [部署计划](#部署计划)
8. [迁移路径](#迁移路径)
9. [未来增强](#未来增强)

---

## 背景与动机

### 当前实现的问题

**文件**: `lib/scheduler.ts` (312行)

**架构**:

```
浏览器(setTimeout) → Zustand Store → Supabase
```

**问题**:

1. **依赖浏览器**: 用户关闭标签页 → 所有调度器停止
2. **单客户端限制**: 只有一个浏览器标签页应该运行调度器(否则会有竞态条件)
3. **无任务持久化**: 服务器重启会丢失所有已调度的任务
4. **监控有限**: 只有 console.log 调试
5. **不可扩展**: 无法在多个工作进程间分配负载

**运行良好的部分**(保留这些模式):

- ✅ 延迟计算: `max(0, last_fetched + interval - now)`
- ✅ 幂等操作: `scheduleFeedRefresh()` 取消现有的 timeout
- ✅ 并发保护: `runningTasks` Set 防止重叠
- ✅ 优雅降级: 刷新失败不会破坏调度器

---

## 需求分析

### 功能需求

**FR1: 自动 Feed 刷新**

- 每个 feed 根据 `last_fetched + refresh_interval` 刷新
- 间隔范围: 1-10080 分钟(1分钟到7天)
- 逾期的 feed(停机期间错过的)在启动时立即刷新

**FR2: 可靠性**

- 任务在服务器重启后持久化
- 失败的任务使用指数退避重试
- 网络错误自动重试(最多3次)
- 解析错误(无效的 RSS XML)不重试

**FR3: 并发控制**

- 最大并发刷新任务: 5(可配置)
- 防止同一 feed 的重复刷新
- 域名速率限制: 每个域名最多 1 req/sec(防止 IP 被封)

**FR4: 监控**

- 查看活跃/已完成/失败的任务
- 任务执行历史(最近24小时)
- 每个 feed 的成功/失败统计
- 任务管理的管理员仪表板

### 非功能性需求

**NFR1: 性能**

- 任务调度延迟: < 5 秒
- Feed 刷新延迟: < 30 秒(P95)
- 支持最多 1000 个 feed 而不降级

**NFR2: 可维护性**

- 队列逻辑和 RSS 解析之间清晰分离
- 类型安全的任务载荷(Zod schemas)
- 全面的日志记录(结构化 JSON)

---

## 架构设计

### 高层数据流

```
┌─────────────────────────────────────────────────────────────┐
│ 触发点(任务创建)                                              │
├─────────────────────────────────────────────────────────────┤
│ 1. 应用启动         → 调度所有 feed                           │
│ 2. 用户添加 Feed    → 调度新 feed                            │
│ 3. 用户更新 Feed    → 用新间隔重新调度                        │
│ 4. 任务完成         → 调度下次执行                            │
│ 5. 手动刷新         → 强制立即执行                            │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ BullMQ 队列: "rss-refresh"                                  │
├─────────────────────────────────────────────────────────────┤
│ 任务架构:                                                    │
│   {                                                         │
│     feedId: string                                          │
│     feedUrl: string                                         │
│     userId: string                                          │
│     lastFetched: Date                                       │
│     refreshInterval: number                                 │
│   }                                                         │
│                                                             │
│ 任务选项:                                                    │
│   - delay: 从 last_fetched + interval 计算                  │
│   - attempts: 3 (仅网络错误)                                │
│   - backoff: 指数退避 (2s, 4s, 8s)                          │
│   - jobId: `feed-${feedId}` (防止重复)                      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 工作进程池(并发: 5)                                           │
├─────────────────────────────────────────────────────────────┤
│ 1. 获取 RSS feed (lib/rss-parser.ts)                        │
│ 2. 解析文章                                                  │
│ 3. 通过 URL 去重                                             │
│ 4. 插入新文章 → Supabase                                     │
│ 5. 更新 feed.last_fetched → Supabase                        │
│ 6. 更新 feed.last_fetch_status                              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 后处理                                                       │
├─────────────────────────────────────────────────────────────┤
│ 成功时:                                                      │
│   - 日志: "已刷新 {feed} (+{N} 篇文章)"                      │
│   - 调度下次运行: delay = refresh_interval                   │
│                                                             │
│ 失败时(可重试):                                              │
│   - 记录错误及上下文                                          │
│   - 使用退避重试(由 BullMQ 管理)                             │
│                                                             │
│ 失败时(不可重试):                                            │
│   - 标记 feed.last_fetch_status = 'failed'                  │
│   - 存储错误消息                                             │
│   - 仍然调度下次运行(用户可能修复 feed URL)                   │
└─────────────────────────────────────────────────────────────┘
```

### 队列设计

**队列名称**: `rss-refresh`

**为什么使用单队列?**

- 所有 RSS 刷新任务具有相似的特性(I/O 密集型,相似的持续时间)
- 优先级系统处理紧急任务(手动刷新 > 自动)
- 简化监控(只需监视一个队列)

**任务去重**:

```typescript
// 使用 feedId 作为 jobId → BullMQ 自动防止重复
await rssQueue.add('refresh', taskPayload, {
  jobId: `feed-${feedId}`,  // 相同 feed = 相同 jobId = 替换旧任务
  delay: calculatedDelay,
})
```

**优先级级别**:

```typescript
enum Priority {
  MANUAL_REFRESH = 1,    // 用户点击"立即刷新"
  OVERDUE = 2,           // Feed 错过计划(>2x 间隔)
  NORMAL = 5,            // 常规计划刷新
}
```

### 数据结构

**任务载荷**(Zod Schema):

```typescript
// lib/queue/schemas.ts
import { z } from 'zod'

export const RSSRefreshTaskSchema = z.object({
  feedId: z.string().uuid(),
  feedUrl: z.string().url(),
  userId: z.string().uuid(),
  lastFetched: z.date().nullable(),
  refreshInterval: z.number().min(1).max(10080),
  priority: z.enum(['manual', 'overdue', 'normal']),
})

export type RSSRefreshTask = z.infer<typeof RSSRefreshTaskSchema>
```

**工作进程状态**(内存):

```typescript
// 跟踪每个域名的运行任务(速率限制)
const domainLocks = new Map<string, Date>()  // domain → 最后请求时间

// 跟踪活跃的 feed 刷新(防止工作进程中的重复)
const runningFeeds = new Set<string>()  // feedId
```

**数据库状态**(现有架构):

```sql
-- feeds 表(无需更改)
CREATE TABLE feeds (
  id UUID PRIMARY KEY,
  url TEXT NOT NULL,
  refresh_interval INTEGER NOT NULL DEFAULT 60,
  last_fetched TIMESTAMPTZ,
  last_fetch_status TEXT,  -- 'success' | 'failed' | null
  last_fetch_error TEXT,
  -- ... 其他列
);
```

### 对比: setTimeout vs BullMQ

| 方面               | setTimeout(当前)  | BullMQ(新)           |
| ------------------ | ----------------- | -------------------- |
| **执行位置** | 浏览器端          | 服务器端 ✅          |
| **持久化**   | 页面关闭时丢失 ❌ | Redis 支持 ✅        |
| **重试**     | 手动实现          | 内置 ✅              |
| **监控**     | console.log       | Bull Board UI ✅     |
| **并发**     | 手动 Set 跟踪     | 内置限制器 ✅        |
| **可扩展性** | 单实例            | 多工作进程 ✅        |
| **代码行数** | ~312 行           | ~200 行(更简单) ✅   |
| **依赖**     | 0                 | +2 (bullmq, ioredis) |

---

## 实施步骤

### 阶段 1: 设置(基础设施)

**1.1 安装依赖**

```bash
# 核心依赖
pnpm add bullmq ioredis

# 开发依赖(类型定义)
pnpm add -D @types/ioredis

# 监控仪表板
pnpm add @bull-board/api @bull-board/ui
```

**1.2 配置 Redis**

**开发环境**(本地 Docker):

```bash
# 在 Docker 中启动 Redis
docker run -d \
  --name redis-dev \
  -p 6379:6379 \
  redis:7-alpine

# 验证连接
redis-cli ping  # 应返回 "PONG"
```

**1.3 环境变量**

```bash
# .env.local (开发)
REDIS_URL=redis://localhost:6379

# .env (生产)
REDIS_URL=redis://:password@redis-host:6379
```

---

### 阶段 2: 核心实现

**2.1 创建队列客户端**

```typescript
// lib/queue/client.ts
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

// Redis 连接(单例)
const redisConnection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,  // BullMQ 所需
  enableReadyCheck: false,
})

// RSS 刷新队列
export const rssQueue = new Queue('rss-refresh', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,  // 2s, 4s, 8s
    },
    removeOnComplete: {
      age: 24 * 3600,  // 保留已完成任务 24 小时
      count: 1000,     // 最多保留 1000 个已完成任务
    },
    removeOnFail: {
      age: 7 * 24 * 3600,  // 保留失败任务 7 天
    },
  },
})

// 优雅关闭
process.on('SIGTERM', async () => {
  await rssQueue.close()
  await redisConnection.quit()
})
```

**2.2 创建任务架构**

```typescript
// lib/queue/schemas.ts
import { z } from 'zod'

export const RSSRefreshTaskSchema = z.object({
  feedId: z.string().uuid(),
  feedUrl: z.string().url(),
  userId: z.string().uuid(),
  lastFetched: z.coerce.date().nullable(),
  refreshInterval: z.number().int().min(1).max(10080),
  priority: z.enum(['manual', 'overdue', 'normal']).default('normal'),
})

export type RSSRefreshTask = z.infer<typeof RSSRefreshTaskSchema>

// 验证辅助函数
export function validateTask(data: unknown): RSSRefreshTask {
  return RSSRefreshTaskSchema.parse(data)
}
```

**2.3 创建队列管理器**

```typescript
// lib/queue/rss-scheduler.ts
import { rssQueue } from './client'
import type { Feed } from '@/lib/types'
import { RSSRefreshTaskSchema } from './schemas'
import { logger } from '@/lib/logger'

/**
 * 计算到下次刷新的延迟(与当前调度器相同的逻辑)
 */
function calculateRefreshDelay(feed: Feed): number {
  const now = Date.now()
  const lastFetched = feed.lastFetched?.getTime() || now
  const intervalMs = feed.refreshInterval * 60 * 1000

  const nextRefreshTime = lastFetched + intervalMs
  const delay = Math.max(0, nextRefreshTime - now)

  return delay
}

/**
 * 确定任务优先级
 */
function calculatePriority(feed: Feed): 'manual' | 'overdue' | 'normal' {
  const delay = calculateRefreshDelay(feed)

  // 如果应该在 >2x 间隔之前刷新则为逾期
  if (delay === 0) {
    const now = Date.now()
    const lastFetched = feed.lastFetched?.getTime() || now
    const overdueThreshold = feed.refreshInterval * 60 * 1000 * 2

    if (now - lastFetched > overdueThreshold) {
      return 'overdue'
    }
  }

  return 'normal'
}

/**
 * 调度 feed 刷新
 * 幂等: 如果已调度则替换现有任务
 */
export async function scheduleFeedRefresh(feed: Feed): Promise<void> {
  const delay = calculateRefreshDelay(feed)
  const priority = calculatePriority(feed)

  // 构建任务载荷
  const taskPayload = RSSRefreshTaskSchema.parse({
    feedId: feed.id,
    feedUrl: feed.url,
    userId: feed.userId,
    lastFetched: feed.lastFetched,
    refreshInterval: feed.refreshInterval,
    priority,
  })

  // 添加到队列(jobId 确保幂等性)
  await rssQueue.add('refresh', taskPayload, {
    jobId: `feed-${feed.id}`,  // 防止重复
    delay,
    priority: priority === 'manual' ? 1 : priority === 'overdue' ? 2 : 5,
  })

  logger.info({
    feedId: feed.id,
    feedTitle: feed.title,
    delaySeconds: Math.round(delay / 1000),
    priority,
  }, '已调度 feed 刷新')
}

/**
 * 取消 feed 刷新
 */
export async function cancelFeedRefresh(feedId: string): Promise<void> {
  const jobId = `feed-${feedId}`
  const job = await rssQueue.getJob(jobId)

  if (job) {
    await job.remove()
    logger.info({ feedId }, '已取消 feed 刷新')
  }
}

/**
 * 强制立即刷新(手动"立即刷新"按钮)
 */
export async function forceRefreshFeed(feedId: string): Promise<void> {
  const { supabase } = await import('@/lib/supabase/client')
  const { data: feed } = await supabase
    .from('feeds')
    .select('*')
    .eq('id', feedId)
    .single()

  if (!feed) {
    throw new Error(`Feed ${feedId} 未找到`)
  }

  // 取消现有任务
  await cancelFeedRefresh(feedId)

  // 调度立即执行
  const taskPayload = RSSRefreshTaskSchema.parse({
    feedId: feed.id,
    feedUrl: feed.url,
    userId: feed.user_id,
    lastFetched: feed.last_fetched ? new Date(feed.last_fetched) : null,
    refreshInterval: feed.refresh_interval,
    priority: 'manual',
  })

  await rssQueue.add('refresh', taskPayload, {
    jobId: `feed-${feed.id}`,
    delay: 0,  // 立即
    priority: 1,
  })

  logger.info({ feedId }, '强制立即刷新')
}

/**
 * 为所有 feed 初始化调度器
 * 应用启动时调用
 */
export async function initializeRSSScheduler(): Promise<void> {
  const { supabase } = await import('@/lib/supabase/client')

  const { data: feeds, error } = await supabase
    .from('feeds')
    .select('*')

  if (error) {
    logger.error({ error }, '为调度器加载 feed 失败')
    throw error
  }

  if (!feeds || feeds.length === 0) {
    logger.info('没有要调度的 feed')
    return
  }

  // 调度所有 feed
  for (const dbFeed of feeds) {
    const feed: Feed = {
      id: dbFeed.id,
      url: dbFeed.url,
      title: dbFeed.title,
      userId: dbFeed.user_id,
      refreshInterval: dbFeed.refresh_interval,
      lastFetched: dbFeed.last_fetched ? new Date(dbFeed.last_fetched) : null,
      // ... 映射其他字段
    } as Feed

    await scheduleFeedRefresh(feed)
  }

  logger.info({ count: feeds.length }, '已初始化 RSS 调度器')
}
```

**2.4 创建工作进程**

```typescript
// lib/queue/worker.ts
import { Worker, Job } from 'bullmq'
import { Redis } from 'ioredis'
import { parseRSSFeed } from '@/lib/rss-parser'
import { supabase } from '@/lib/supabase/client'
import { validateTask, type RSSRefreshTask } from './schemas'
import { logger } from '@/lib/logger'
import { scheduleFeedRefresh } from './rss-scheduler'

// 工作进程的 Redis 连接
const redisConnection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
})

// 域名速率限制(防止 IP 被封)
const domainLocks = new Map<string, number>()
const RATE_LIMIT_MS = 1000  // 每个域名 1 req/sec

async function waitForDomainRateLimit(url: string): Promise<void> {
  const domain = new URL(url).hostname
  const lastRequest = domainLocks.get(domain) || 0
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequest

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    const waitTime = RATE_LIMIT_MS - timeSinceLastRequest
    logger.debug({ domain, waitTime }, '域名速率限制')
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }

  domainLocks.set(domain, Date.now())
}

// 工作进程实现
export const rssWorker = new Worker<RSSRefreshTask>(
  'rss-refresh',
  async (job: Job<RSSRefreshTask>) => {
    const startTime = Date.now()

    // 验证任务载荷
    const task = validateTask(job.data)

    logger.info({
      jobId: job.id,
      feedId: task.feedId,
      feedUrl: task.feedUrl,
      attempt: job.attemptsMade + 1,
    }, '处理 RSS 刷新任务')

    try {
      // 速率限制
      await waitForDomainRateLimit(task.feedUrl)

      // 解析 RSS feed
      const { articles } = await parseRSSFeed(task.feedUrl, task.feedId)

      // 插入文章(使用 Supabase upsert 去重)
      const { error: insertError } = await supabase
        .from('articles')
        .upsert(
          articles.map(article => ({
            id: article.id,
            feed_id: article.feedId,
            title: article.title,
            url: article.url,
            content: article.content,
            published_at: article.publishedAt.toISOString(),
            // ... 其他字段
          })),
          { onConflict: 'url', ignoreDuplicates: true }
        )

      if (insertError) throw insertError

      // 更新 feed 状态
      const { error: updateError } = await supabase
        .from('feeds')
        .update({
          last_fetched: new Date().toISOString(),
          last_fetch_status: 'success',
          last_fetch_error: null,
        })
        .eq('id', task.feedId)

      if (updateError) throw updateError

      const duration = Date.now() - startTime

      logger.info({
        jobId: job.id,
        feedId: task.feedId,
        articleCount: articles.length,
        duration,
      }, '成功刷新 feed')

      // 重新调度下次运行
      await rescheduleAfterCompletion(task.feedId)

      return { success: true, articleCount: articles.length }

    } catch (error) {
      const duration = Date.now() - startTime
      const errorMsg = error instanceof Error ? error.message : String(error)

      logger.error({
        jobId: job.id,
        feedId: task.feedId,
        error: errorMsg,
        duration,
        attempt: job.attemptsMade + 1,
      }, '刷新 feed 失败')

      // 更新 feed 状态
      await supabase
        .from('feeds')
        .update({
          last_fetched: new Date().toISOString(),
          last_fetch_status: 'failed',
          last_fetch_error: errorMsg,
        })
        .eq('id', task.feedId)

      // 确定错误是否可重试
      const isNetworkError = errorMsg.includes('ENOTFOUND') ||
                            errorMsg.includes('ETIMEDOUT') ||
                            errorMsg.includes('fetch failed')

      if (!isNetworkError) {
        // 不可重试的错误(例如,无效的 XML)
        // 标记任务为失败但仍然重新调度(用户可能修复 feed URL)
        await rescheduleAfterCompletion(task.feedId)
        throw new Error(`不可重试的错误: ${errorMsg}`)
      }

      // 可重试的错误 - 让 BullMQ 处理重试
      throw error
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,  // 最多 5 个并行刷新
  }
)

// 辅助函数: 完成后重新调度
async function rescheduleAfterCompletion(feedId: string): Promise<void> {
  const { data: dbFeed } = await supabase
    .from('feeds')
    .select('*')
    .eq('id', feedId)
    .single()

  if (!dbFeed) {
    logger.warn({ feedId }, '刷新后未找到 feed,不重新调度')
    return
  }

  // 将 DB 行转换为 Feed 类型
  const feed = {
    id: dbFeed.id,
    url: dbFeed.url,
    userId: dbFeed.user_id,
    refreshInterval: dbFeed.refresh_interval,
    lastFetched: dbFeed.last_fetched ? new Date(dbFeed.last_fetched) : null,
    // ... 其他字段
  }

  await scheduleFeedRefresh(feed as any)
}

// 事件监听器
rssWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, '任务已完成')
})

rssWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, '任务失败')
})

rssWorker.on('error', (err) => {
  logger.error({ error: err.message }, '工作进程错误')
})

// 优雅关闭
process.on('SIGTERM', async () => {
  logger.info('正在关闭 RSS 工作进程...')
  await rssWorker.close()
  await redisConnection.quit()
  process.exit(0)
})
```

**2.5 在 Next.js 中启动工作进程**

```typescript
// app/api/worker/route.ts
import { rssWorker } from '@/lib/queue/worker'

// 保持工作进程运行
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 健康检查端点
export async function GET() {
  const isRunning = await rssWorker.isRunning()

  return Response.json({
    status: isRunning ? 'running' : 'stopped',
    concurrency: 5,
  })
}

// 注意: 导入此模块时工作进程自动启动
// 对于生产环境,将工作进程作为单独的进程运行(参见部署章节)
```

---

### 阶段 3: 集成

**3.1 更新 Store Actions**

```typescript
// lib/store/feeds.slice.ts
import { scheduleFeedRefresh, cancelFeedRefresh } from '@/lib/queue/rss-scheduler'

export const createFeedsSlice: StateCreator<
  RSSReaderState,
  [],
  [],
  FeedsSlice
> = (set, get) => ({
  // ... 现有代码

  addFeed: async (feed) => {
    set((state) => ({ feeds: [...state.feeds, feed] }))
    await syncFeedToSupabase(feed)

    // 新增: 使用 BullMQ 而不是 setTimeout 调度
    await scheduleFeedRefresh(feed)
  },

  updateFeed: async (feedId, updates) => {
    set((state) => ({
      feeds: state.feeds.map(f =>
        f.id === feedId ? { ...f, ...updates } : f
      )
    }))
    await syncFeedUpdateToSupabase(feedId, updates)

    // 新增: 如果间隔或 URL 改变则重新调度
    if (updates.refreshInterval !== undefined || updates.url !== undefined) {
      const updatedFeed = get().feeds.find(f => f.id === feedId)
      if (updatedFeed) {
        await scheduleFeedRefresh(updatedFeed)
      }
    }
  },

  deleteFeed: async (feedId) => {
    set((state) => ({ feeds: state.feeds.filter(f => f.id !== feedId) }))
    await deleteFeedFromSupabase(feedId)

    // 新增: 取消已调度的任务
    await cancelFeedRefresh(feedId)
  },
})
```

**3.2 更新应用初始化**

```typescript
// app/(reader)/layout.tsx
import { initializeRSSScheduler } from '@/lib/queue/rss-scheduler'

export default function ReaderLayout({ children }) {
  useEffect(() => {
    if (isDatabaseReady) {
      loadFromSupabase()

      // 旧: lib/scheduler.ts 中的 initializeScheduler()
      // 新: 初始化 BullMQ 调度器
      initializeRSSScheduler().catch(console.error)
    }
  }, [isDatabaseReady])

  // ... 布局的其余部分
}
```

---

### 阶段 4: 监控仪表板

**4.1 安装 Bull Board**

```bash
pnpm add @bull-board/api @bull-board/nextjs
```

**4.2 创建仪表板路由**

```typescript
// app/api/admin/queues/[[...path]]/route.ts
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { NextJsAdapter } from '@bull-board/nextjs'
import { rssQueue } from '@/lib/queue/client'

const serverAdapter = new NextJsAdapter()

createBullBoard({
  queues: [new BullMQAdapter(rssQueue)],
  serverAdapter,
})

serverAdapter.setBasePath('/api/admin/queues')

export const GET = serverAdapter.registerPlugin()
export const POST = serverAdapter.registerPlugin()
```

**4.3 访问仪表板**

导航到: `http://localhost:3000/api/admin/queues`

**仪表板功能**:

- ✅ 查看活跃/等待/已完成/失败的任务
- ✅ 重试失败的任务
- ✅ 删除任务
- ✅ 查看任务详情(载荷、日志、堆栈跟踪)
- ✅ 实时更新

---

## 边缘情况与错误处理

### 1. 服务器重启 - 任务恢复

**场景**: 服务器崩溃时有 10 个 feed 已调度

**解决方案**:

- ✅ 任务在 Redis 中持久化
- ✅ 工作进程重启时延迟任务自动执行
- ✅ 无数据丢失

**测试**:

```bash
# 调度任务
curl -X POST /api/feeds -d '{"url": "https://example.com/feed"}'

# 杀死服务器
kill -9 <pid>

# 重启服务器
pnpm dev

# 验证: 检查 Bull Board - 任务仍在队列中
```

### 2. 重复任务防护

**场景**: 用户快速连续点击"立即刷新" 5 次

**解决方案**:

```typescript
// jobId 确保每个 feed 只有一个任务
await rssQueue.add('refresh', payload, {
  jobId: `feed-${feedId}`,  // 替换现有任务
})
```

**测试**:

```typescript
await forceRefreshFeed('feed-123')
await forceRefreshFeed('feed-123')
await forceRefreshFeed('feed-123')

// 预期: 队列中只有 1 个任务(检查 Bull Board)
```

### 3. 网络超时

**场景**: RSS feed 服务器需要 60 秒才响应

**解决方案**:

```typescript
// 在 rss-parser.ts 中添加超时
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 30000)  // 30秒超时

try {
  const response = await fetch(url, { signal: controller.signal })
  // ...
} finally {
  clearTimeout(timeout)
}
```

**BullMQ 重试**:

- 尝试 1: 超时 → 2秒后重试
- 尝试 2: 超时 → 4秒后重试
- 尝试 3: 超时 → 标记为失败

### 4. 无效的 RSS XML

**场景**: Feed 返回 HTML 而不是 XML

**解决方案**:

```typescript
// 在 worker.ts 中
try {
  await parseRSSFeed(url)
} catch (error) {
  if (error.message.includes('Invalid XML')) {
    // 不可重试的错误 - 不重试
    await supabase.update({ last_fetch_error: '无效的 feed 格式' })
    throw new Error('不可重试: 无效的 XML')
  }
  throw error  // 可重试的错误
}
```

### 5. 刷新期间 Feed 被删除

**场景**: Feed 正在刷新,用户在执行中间删除它

**解决方案**:

```typescript
// 在 worker.ts 刷新后
const { data: feed } = await supabase.from('feeds').select('id').eq('id', feedId).single()

if (!feed) {
  logger.info('刷新期间 feed 被删除,不重新调度')
  return  // 不重新调度
}

await scheduleFeedRefresh(feed)
```

### 6. Redis 连接丢失

**场景**: Redis 服务器宕机

**解决方案**:

```typescript
// BullMQ 使用指数退避自动重连
// 工作进程暂停直到连接恢复

// 添加监控
rssWorker.on('error', (error) => {
  if (error.message.includes('ECONNREFUSED')) {
    logger.error('Redis 连接丢失 - 工作进程已暂停')
    // 向管理员发送警报(电子邮件、Slack 等)
  }
})
```

---

## 测试策略

### 单元测试

**测试文件**: `lib/queue/__tests__/rss-scheduler.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { calculateRefreshDelay } from '../rss-scheduler'

describe('calculateRefreshDelay', () => {
  it('对逾期的 feed 返回 0', () => {
    const feed = {
      lastFetched: new Date(Date.now() - 2 * 60 * 60 * 1000),  // 2 小时前
      refreshInterval: 60,  // 60 分钟
    }

    expect(calculateRefreshDelay(feed)).toBe(0)
  })

  it('为未来的刷新计算正确的延迟', () => {
    const feed = {
      lastFetched: new Date(Date.now() - 30 * 60 * 1000),  // 30 分钟前
      refreshInterval: 60,
    }

    const delay = calculateRefreshDelay(feed)
    expect(delay).toBeGreaterThan(29 * 60 * 1000)
    expect(delay).toBeLessThan(31 * 60 * 1000)
  })
})
```

### 集成测试

**测试文件**: `lib/queue/__tests__/integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { rssQueue } from '../client'
import { scheduleFeedRefresh } from '../rss-scheduler'

describe('BullMQ 集成', () => {
  beforeAll(async () => {
    // 测试前清空队列
    await rssQueue.obliterate({ force: true })
  })

  afterAll(async () => {
    await rssQueue.close()
  })

  it('调度 feed 刷新', async () => {
    const feed = {
      id: 'test-feed-1',
      url: 'https://example.com/feed',
      refreshInterval: 60,
      lastFetched: new Date(),
    }

    await scheduleFeedRefresh(feed)

    const job = await rssQueue.getJob(`feed-${feed.id}`)
    expect(job).toBeDefined()
    expect(job?.data.feedUrl).toBe(feed.url)
  })

  it('防止重复任务', async () => {
    const feed = { id: 'test-feed-2', url: 'https://example.com/feed2' }

    await scheduleFeedRefresh(feed)
    await scheduleFeedRefresh(feed)

    const jobs = await rssQueue.getJobs(['waiting', 'delayed'])
    const duplicates = jobs.filter(j => j.data.feedId === feed.id)

    expect(duplicates.length).toBe(1)  // 只有 1 个任务
  })
})
```

### 手动测试清单

**场景 1: 基本刷新**

- [ ] 添加新 feed
- [ ] 验证任务出现在 Bull Board 中
- [ ] 等待执行(或设置短间隔)
- [ ] 检查 articles 表中的新条目
- [ ] 验证 `last_fetched` 已更新

**场景 2: 立即刷新**

- [ ] 点击"立即刷新"按钮
- [ ] 验证任务在 5 秒内执行
- [ ] 检查 Bull Board 显示"已完成"状态

**场景 3: 刷新失败**

- [ ] 添加具有无效 URL 的 feed
- [ ] 等待执行
- [ ] 验证任务重试 3 次
- [ ] 检查 `last_fetch_error` 字段已填充
- [ ] 验证仍然调度下次刷新

**场景 4: 服务器重启**

- [ ] 调度 5 个 feed(30分钟间隔)
- [ ] 停止服务器
- [ ] 等待 5 分钟
- [ ] 重启服务器
- [ ] 验证所有 5 个任务仍然调度
- [ ] 检查 Bull Board 中的待处理任务

---

## 部署计划

### 开发环境

```bash
# 启动 Redis
docker-compose up -d redis

# 启动 Next.js(包括工作进程)
pnpm dev

# 访问监控
open http://localhost:3000/api/admin/queues
```

### 生产环境

**选项 A: Vercel + Upstash Redis** (推荐用于小规模)

```bash
# 1. 部署到 Vercel
vercel

# 2. 添加 Redis 集成
vercel integration add upstash

# 3. 环境变量(由集成自动配置)
REDIS_URL=redis://...

# 4. 注意: Vercel 无服务器函数有 10 秒超时
# 解决方案: 将工作进程作为单独的服务运行(Railway、Render、Fly.io)
```

**选项 B: VPS (完全控制)**

```bash
# 1. 安装 Redis
sudo apt install redis-server

# 2. 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. 克隆仓库并安装依赖
git clone <repo>
cd <repo>
pnpm install

# 4. 构建应用
pnpm build

# 5. 启动工作进程(PM2)
pm2 start ecosystem.config.js

# 6. 启动 Next.js
pm2 start pnpm --name "nextjs" -- start
```

**PM2 配置**:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'rss-worker',
      script: 'node_modules/.bin/tsx',
      args: 'lib/queue/worker.ts',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
      },
    },
    {
      name: 'nextjs',
      script: 'pnpm',
      args: 'start',
      instances: 1,
      autorestart: true,
    },
  ],
}
```

**选项 C: Docker Compose** (推荐用于 VPS)

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  worker:
    build: .
    command: tsx lib/queue/worker.ts
    restart: always
    depends_on:
      redis:
        condition: service_healthy
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=${DATABASE_URL}
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}

  app:
    build: .
    command: pnpm start
    restart: always
    ports:
      - "3000:3000"
    depends_on:
      - redis
      - worker
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=${DATABASE_URL}
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}

volumes:
  redis-data:
```

---

## 迁移路径

### 步骤 1: 并行运行(1周)

**目标**: 同时运行两个调度器,比较行为

```typescript
// lib/scheduler-migration.ts
import { scheduleFeedRefresh as oldScheduler } from './scheduler'
import { scheduleFeedRefresh as newScheduler } from './queue/rss-scheduler'

export async function scheduleFeedRefresh(feed: Feed) {
  // 运行两个调度器
  oldScheduler(feed)  // setTimeout(当前)
  await newScheduler(feed)  // BullMQ(新)

  // 记录哪个先执行
  logger.info({ feedId: feed.id }, '使用两个系统调度')
}
```

**验证**:

- 比较执行时间
- 检查遗漏的刷新
- 监控错误率

### 步骤 2: 切换到 BullMQ(验证后)

```typescript
// 移除旧调度器
import { scheduleFeedRefresh } from './queue/rss-scheduler'  // 使用新的

// 删除 lib/scheduler.ts(先备份)
```

### 步骤 3: 清理

```bash
# 移除旧代码
rm lib/scheduler.ts

# 更新代码库中的导入
git grep "lib/scheduler" | xargs sed -i 's|lib/scheduler|lib/queue/rss-scheduler|g'

# 提交
git commit -m "feat: 将 RSS 调度器从 setTimeout 迁移到 BullMQ"
```

---

## 未来增强

### 阶段 2: 视频下载队列(已计划)

```typescript
// lib/queue/video-queue.ts
export const videoQueue = new Queue('video-processing', {
  connection: redisConnection,
})

// 任务链: 下载 → 转码 → 上传
await videoQueue.add('download', { url: 'https://youtube.com/watch?v=xxx' })
await videoQueue.add('transcode', { videoId: 'xxx' }, {
  parent: { id: downloadJob.id, queue: 'video-processing' }
})
```

### 阶段 3: 高级功能(可选)

**速率限制仪表板**:

```typescript
// 跟踪 API 配额使用情况
await rssQueue.add('refresh', payload, {
  rateLimiter: {
    max: 100,  // 100 个请求
    duration: 60000,  // 每分钟
    groupKey: 'rss-refresh',
  },
})
```

**任务指标**:

```typescript
// Prometheus 指标导出
import { MetricsTime } from 'bull-board'

const metrics = await MetricsTime(rssQueue, {
  start: Date.now() - 24 * 3600 * 1000,
  end: Date.now(),
})

// 导出到 Grafana/Datadog
```

**Webhooks**:

```typescript
// 任务完成时通知
rssWorker.on('completed', async (job) => {
  await fetch('https://example.com/webhook', {
    method: 'POST',
    body: JSON.stringify({
      event: 'feed.refreshed',
      feedId: job.data.feedId,
      articleCount: job.returnvalue.articleCount,
    }),
  })
})
```

---

## 附录

### A. BullMQ vs setTimeout 对比

| 功能           | setTimeout    | BullMQ               |
| -------------- | ------------- | -------------------- |
| 任务持久化     | ❌ 重启时丢失 | ✅ Redis 支持        |
| 重试逻辑       | 手动          | ✅ 内置              |
| 并发控制       | 手动 Set      | ✅ 内置              |
| 监控           | console.log   | ✅ Bull Board UI     |
| 优先队列       | 手动          | ✅ 内置              |
| 延迟任务       | ✅ setTimeout | ✅ 内置              |
| 分布式工作进程 | ❌            | ✅                   |
| 任务去重       | 手动          | ✅ jobId             |
| 事件钩子       | ❌            | ✅ on('completed')   |
| 内存使用       | ~500B/feed    | ~1KB/job             |
| 依赖           | 0             | +2 (bullmq, ioredis) |

### B. Redis 内存估算

```typescript
// 每个任务的开销(大约):
// - Job ID: 36 字节(UUID)
// - 载荷: ~200 字节(RSSRefreshTask)
// - BullMQ 元数据: ~500 字节
// - 总计: 每个任务 ~750 字节

// 对于 1000 个 feed:
// - 活跃任务: 1000 × 750B = 750KB
// - 已完成(最近 24 小时): ~500 个任务 × 750B = 375KB
// - 失败(最近 7 天): ~50 个任务 × 750B = 37.5KB
// - 总计: ~1.2MB

// Redis 内存: ~5MB(包括开销)
```

### C. 有用的命令

```bash
# 监控 Redis 内存
redis-cli INFO memory

# 按状态计数任务
redis-cli KEYS "bull:rss-refresh:*" | wc -l

# 清除所有任务(危险!)
await rssQueue.obliterate({ force: true })

# 获取队列统计
const waiting = await rssQueue.getWaitingCount()
const active = await rssQueue.getActiveCount()
const completed = await rssQueue.getCompletedCount()
const failed = await rssQueue.getFailedCount()

console.log({ waiting, active, completed, failed })
```

---

## 决策日志

| 日期       | 决策                     | 理由                           |
| ---------- | ------------------------ | ------------------------------ |
| 2025-11-26 | 使用 BullMQ 而非 inngest | 开源、零供应商锁定、复杂度更低 |
| 2025-11-26 | 单队列 `rss-refresh`   | 所有 RSS 任务具有相似特性      |
| 2025-11-26 | 并发: 5                  | 在速度和服务器负载之间取得平衡 |
| 2025-11-26 | 保留已完成任务 24 小时   | 调试 + 监控,不会臃肿           |
| 2025-11-26 | 使用 `jobId` 去重      | 防止同一 feed 的重复刷新       |
| 2025-11-26 | 域名速率限制: 1 req/s    | 防止激进的 RSS 服务器封禁 IP   |

---

**状态**: 准备实施
**预估工作量**: 8-12 小时
**风险级别**: 低(可与现有调度器并行运行)
**需要审查**: 是(在移除旧调度器之前)
