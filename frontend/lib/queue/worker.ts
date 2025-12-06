/**
 * RSS Refresh Worker - BullMQ Worker Process
 *
 * This worker runs as a separate process from the Next.js app.
 * It processes RSS refresh jobs from the queue.
 *
 * Key Design:
 * - Uses service role key to bypass RLS (worker has no user session)
 * - Direct RSS parsing with rss-parser (not API route)
 * - Domain rate limiting to prevent IP bans
 * - Automatic rescheduling after each job completes
 *
 * Run with: npx tsx lib/queue/worker.ts
 * Or in production: pm2 start lib/queue/worker.ts --interpreter npx --interpreter-args="tsx"
 */

import { Worker, Job } from "bullmq"
import { createClient } from "@supabase/supabase-js"
import Parser from "rss-parser"
import { getWorkerConnection, closeAllConnections } from "./redis"
import { validateTask, type RSSRefreshTask, type TaskResult } from "./schemas"
import { logger } from "../logger"

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_NAME = "rss-refresh"
const CONCURRENCY = 5 // Max parallel jobs
const RATE_LIMIT_MS = 1000 // 1 req/sec per domain

// ============================================================================
// Supabase Client (Service Role - bypasses RLS)
// ============================================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable")
}

if (!supabaseServiceKey) {
  logger.warn(
    "Missing SUPABASE_SERVICE_ROLE_KEY - falling back to anon key. " +
      "Worker may fail if RLS policies prevent insert/update."
  )
}

// Use service role key if available, otherwise fall back to anon key
const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

// ============================================================================
// RSS Parser
// ============================================================================

const rssParser = new Parser({
  customFields: {
    feed: ["image"],
    item: ["media:thumbnail", "media:content", "enclosure", "description"],
  },
})

// ============================================================================
// Domain Rate Limiting
// ============================================================================

const domainLastRequest = new Map<string, number>()

async function waitForDomainRateLimit(url: string): Promise<void> {
  const domain = new URL(url).hostname
  const lastRequest = domainLastRequest.get(domain) || 0
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequest

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    const waitTime = RATE_LIMIT_MS - timeSinceLastRequest
    logger.debug({ domain, waitTime }, "Rate limiting domain")
    await new Promise((resolve) => setTimeout(resolve, waitTime))
  }

  domainLastRequest.set(domain, Date.now())
}

// ============================================================================
// Job Processor
// ============================================================================

async function processRSSRefresh(job: Job<RSSRefreshTask>): Promise<TaskResult> {
  const startTime = Date.now()

  // Validate job data
  const task = validateTask(job.data)

  logger.info(
    {
      jobId: job.id,
      feedId: task.feedId,
      feedUrl: task.feedUrl,
      feedTitle: task.feedTitle,
      attempt: job.attemptsMade + 1,
    },
    "Processing RSS refresh job"
  )

  try {
    // Rate limit by domain
    await waitForDomainRateLimit(task.feedUrl)

    // Parse RSS feed
    const feed = await rssParser.parseURL(task.feedUrl)

    // Transform articles
    const articles = feed.items.map((item) => {
      // Extract thumbnail
      let thumbnail: string | undefined

      if (item["media:thumbnail"]) {
        thumbnail = Array.isArray(item["media:thumbnail"])
          ? item["media:thumbnail"][0]?.url || item["media:thumbnail"][0]
          : (item as any)["media:thumbnail"].url || item["media:thumbnail"]
      } else if (item["media:content"]) {
        thumbnail = Array.isArray(item["media:content"])
          ? (item as any)["media:content"][0]?.url
          : (item as any)["media:content"].url
      } else if (item.enclosure && item.enclosure.type?.startsWith("image/")) {
        thumbnail = item.enclosure.url
      }

      const content =
        item.content || item["content:encoded"] || item.description || item.summary || ""
      const summary = item.contentSnippet || item.summary || item.description || ""

      return {
        id: crypto.randomUUID(),
        feed_id: task.feedId,
        user_id: task.userId,
        title: item.title || "Untitled",
        content,
        summary: summary.length > 200 ? summary.substring(0, 200) + "..." : summary,
        url: item.link || "",
        author: item.creator || item.author || (item as any)["dc:creator"],
        published_at: new Date(item.pubDate || item.isoDate || Date.now()).toISOString(),
        is_read: false,
        is_starred: false,
        thumbnail,
      }
    })

    // Upsert articles (deduplicate by URL)
    if (articles.length > 0) {
      const { error: insertError } = await supabase.from("articles").upsert(articles, {
        onConflict: "url,user_id",
        ignoreDuplicates: true,
      })

      if (insertError) {
        logger.error({ error: insertError, feedId: task.feedId }, "Failed to insert articles")
        throw insertError
      }
    }

    // Update feed status
    const { error: updateError } = await supabase
      .from("feeds")
      .update({
        last_fetched: new Date().toISOString(),
        last_fetch_status: "success",
        last_fetch_error: null,
      })
      .eq("id", task.feedId)
      .eq("user_id", task.userId)

    if (updateError) {
      logger.error({ error: updateError, feedId: task.feedId }, "Failed to update feed status")
      throw updateError
    }

    const duration = Date.now() - startTime

    logger.info(
      {
        jobId: job.id,
        feedId: task.feedId,
        feedTitle: task.feedTitle,
        articleCount: articles.length,
        duration,
      },
      "Successfully refreshed feed"
    )

    // Schedule next refresh
    await scheduleNextRefresh(task)

    return {
      success: true,
      articleCount: articles.length,
      duration,
    }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMsg = error instanceof Error ? error.message : String(error)

    logger.error(
      {
        jobId: job.id,
        feedId: task.feedId,
        feedTitle: task.feedTitle,
        error: errorMsg,
        duration,
        attempt: job.attemptsMade + 1,
      },
      "Failed to refresh feed"
    )

    // Update feed status with error
    await supabase
      .from("feeds")
      .update({
        last_fetched: new Date().toISOString(),
        last_fetch_status: "failed",
        last_fetch_error: errorMsg,
      })
      .eq("id", task.feedId)
      .eq("user_id", task.userId)

    // Determine if error is retryable
    const isNetworkError =
      errorMsg.includes("ENOTFOUND") ||
      errorMsg.includes("ETIMEDOUT") ||
      errorMsg.includes("ECONNREFUSED") ||
      errorMsg.includes("fetch failed") ||
      errorMsg.includes("socket hang up")

    if (!isNetworkError) {
      // Non-retryable error (e.g., invalid XML)
      // Still schedule next refresh - user might fix the feed URL
      await scheduleNextRefresh(task)
      throw new Error(`Non-retryable error: ${errorMsg}`)
    }

    // Retryable error - let BullMQ handle retry
    throw error
  }
}

/**
 * Schedule next refresh after job completion
 * Re-fetches feed data to get updated last_fetched
 */
async function scheduleNextRefresh(task: RSSRefreshTask): Promise<void> {
  try {
    // Import queue module dynamically to avoid circular dependency
    const { getRSSQueue } = await import("./rss-queue")
    const queue = getRSSQueue()

    // Get updated feed data
    const { data: dbFeed, error } = await supabase
      .from("feeds")
      .select("*")
      .eq("id", task.feedId)
      .eq("user_id", task.userId)
      .single()

    if (error || !dbFeed) {
      logger.warn({ feedId: task.feedId }, "Feed not found after refresh, not rescheduling")
      return
    }

    // Calculate delay for next refresh
    const lastFetched = dbFeed.last_fetched ? new Date(dbFeed.last_fetched).getTime() : Date.now()
    const intervalMs = dbFeed.refresh_interval * 60 * 1000
    const nextRefreshTime = lastFetched + intervalMs
    const delay = Math.max(0, nextRefreshTime - Date.now())

    // Schedule next refresh
    await queue.add(
      "refresh",
      {
        feedId: dbFeed.id,
        feedUrl: dbFeed.url,
        feedTitle: dbFeed.title,
        userId: task.userId,
        lastFetched: dbFeed.last_fetched ? new Date(dbFeed.last_fetched) : null,
        refreshInterval: dbFeed.refresh_interval,
        priority: "normal",
      },
      {
        jobId: `feed-${dbFeed.id}`,
        delay,
        priority: 5, // Normal priority
      }
    )

    logger.debug(
      {
        feedId: dbFeed.id,
        delaySeconds: Math.round(delay / 1000),
      },
      "Scheduled next refresh"
    )
  } catch (error) {
    logger.error({ error, feedId: task.feedId }, "Failed to schedule next refresh")
    // Don't throw - this shouldn't fail the job
  }
}

// ============================================================================
// Worker Instance
// ============================================================================

const worker = new Worker<RSSRefreshTask>(QUEUE_NAME, processRSSRefresh, {
  connection: getWorkerConnection(),
  concurrency: CONCURRENCY,
})

// Event handlers
worker.on("completed", (job, result: TaskResult) => {
  logger.info(
    {
      jobId: job.id,
      feedId: job.data.feedId,
      articleCount: result.articleCount,
      duration: result.duration,
    },
    "Job completed"
  )
})

worker.on("failed", (job, err) => {
  logger.error(
    {
      jobId: job?.id,
      feedId: job?.data.feedId,
      error: err.message,
      attempts: job?.attemptsMade,
    },
    "Job failed"
  )
})

worker.on("error", (err) => {
  logger.error({ error: err.message }, "Worker error")
})

worker.on("ready", () => {
  logger.info({ concurrency: CONCURRENCY }, "RSS Worker ready and listening for jobs")
})

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Received shutdown signal, closing worker...")

  try {
    await worker.close()
    logger.info("Worker closed")

    await closeAllConnections()
    logger.info("Redis connections closed")

    process.exit(0)
  } catch (error) {
    logger.error({ error }, "Error during shutdown")
    process.exit(1)
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

// ============================================================================
// Health Check Export (for API endpoint)
// ============================================================================

export async function isWorkerRunning(): Promise<boolean> {
  return worker.isRunning()
}

export { worker }

// Log startup
logger.info(
  {
    queueName: QUEUE_NAME,
    concurrency: CONCURRENCY,
    rateLimitMs: RATE_LIMIT_MS,
  },
  "RSS Worker starting..."
)
