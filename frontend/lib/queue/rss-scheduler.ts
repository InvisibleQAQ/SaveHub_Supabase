/**
 * RSS Scheduler Manager - BullMQ Implementation
 *
 * Replaces lib/scheduler.ts (setTimeout-based)
 *
 * Key Differences:
 * - Jobs persist in Redis (survives server restart)
 * - Automatic retry with exponential backoff
 * - Priority queue (manual refresh > overdue > normal)
 * - JobId-based deduplication (one job per feed)
 *
 * Same Core Logic:
 * - Delay calculation: max(0, last_fetched + interval - now)
 * - Idempotent scheduling (replaces existing job)
 */

import type { Feed } from "@/lib/types"
import { getRSSQueue } from "./rss-queue"
import { RSSRefreshTaskSchema, PriorityLevel, type RSSRefreshTask } from "./schemas"
import { logger } from "@/lib/logger"
import { supabase } from "@/lib/supabase/client"

/**
 * Calculate delay until next refresh based on last_fetched timestamp
 *
 * Formula: delay = max(0, last_fetched + interval - now)
 *
 * Edge cases:
 * - If last_fetched is missing, use current time (immediate refresh)
 * - If delay < 0 (overdue), return 0 (immediate refresh)
 *
 * @returns Delay in milliseconds until next refresh
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
 * Determine task priority based on feed state
 */
function calculatePriority(feed: Feed): "manual" | "overdue" | "normal" {
  const delay = calculateRefreshDelay(feed)

  // If delay is 0, check if it's significantly overdue
  if (delay === 0 && feed.lastFetched) {
    const now = Date.now()
    const lastFetched = feed.lastFetched.getTime()
    const overdueThreshold = feed.refreshInterval * 60 * 1000 * 2 // 2x interval

    if (now - lastFetched > overdueThreshold) {
      return "overdue"
    }
  }

  return "normal"
}

/**
 * Get userId from Supabase auth session
 * Required for job payload (worker needs userId for DB operations)
 */
async function getCurrentUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Error("Not authenticated - cannot schedule feed refresh")
  }

  return user.id
}

/**
 * Schedule a feed for automatic refresh
 *
 * Behavior:
 * - Replaces existing job if already scheduled (idempotent via jobId)
 * - Calculates delay from last_fetched + refresh_interval
 * - Higher priority for manual/overdue refreshes
 *
 * @param feed - Feed to schedule
 * @param forceImmediate - If true, refresh immediately (for "Refresh Now" button)
 */
export async function scheduleFeedRefresh(
  feed: Feed,
  forceImmediate = false
): Promise<void> {
  try {
    const userId = await getCurrentUserId()
    const queue = getRSSQueue()

    const priority = forceImmediate ? "manual" : calculatePriority(feed)
    const delay = forceImmediate ? 0 : calculateRefreshDelay(feed)

    // Build and validate task payload
    const taskPayload: RSSRefreshTask = RSSRefreshTaskSchema.parse({
      feedId: feed.id,
      feedUrl: feed.url,
      feedTitle: feed.title,
      userId,
      lastFetched: feed.lastFetched,
      refreshInterval: feed.refreshInterval,
      priority,
    })

    // Add to queue with unique jobId per feed
    // If job with same jobId exists, it will be replaced
    await queue.add("refresh", taskPayload, {
      jobId: `feed-${feed.id}`, // Ensures one job per feed
      delay,
      priority: PriorityLevel[priority],
    })

    const delaySeconds = Math.round(delay / 1000)
    logger.info(
      {
        feedId: feed.id,
        feedTitle: feed.title,
        delaySeconds,
        priority,
        userId,
      },
      `Scheduled feed refresh in ${delaySeconds}s`
    )
  } catch (error) {
    logger.error(
      {
        error,
        feedId: feed.id,
        feedTitle: feed.title,
      },
      "Failed to schedule feed refresh"
    )
    throw error
  }
}

/**
 * Cancel scheduled refresh for a feed
 * Safe to call even if feed isn't scheduled (idempotent)
 */
export async function cancelFeedRefresh(feedId: string): Promise<void> {
  try {
    const queue = getRSSQueue()
    const jobId = `feed-${feedId}`

    const job = await queue.getJob(jobId)
    if (job) {
      await job.remove()
      logger.info({ feedId }, "Cancelled feed refresh")
    }
  } catch (error) {
    logger.error({ error, feedId }, "Failed to cancel feed refresh")
    // Don't rethrow - cancellation failure shouldn't break delete flow
  }
}

/**
 * Force immediate refresh of a feed (bypasses schedule)
 * Used for "Refresh Now" button
 */
export async function forceRefreshFeed(feedId: string): Promise<void> {
  // Get current feed data from store or database
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Not authenticated")
  }

  const { data: dbFeed, error } = await supabase
    .from("feeds")
    .select("*")
    .eq("id", feedId)
    .eq("user_id", user.id)
    .single()

  if (error || !dbFeed) {
    throw new Error(`Feed ${feedId} not found`)
  }

  // Convert DB row to Feed type
  const feed: Feed = {
    id: dbFeed.id,
    title: dbFeed.title,
    url: dbFeed.url,
    description: dbFeed.description || undefined,
    category: dbFeed.category || undefined,
    folderId: dbFeed.folder_id || undefined,
    order: dbFeed.order,
    unreadCount: dbFeed.unread_count,
    refreshInterval: dbFeed.refresh_interval,
    lastFetched: dbFeed.last_fetched ? new Date(dbFeed.last_fetched) : undefined,
    lastFetchStatus: dbFeed.last_fetch_status || undefined,
    lastFetchError: dbFeed.last_fetch_error || undefined,
  }

  await scheduleFeedRefresh(feed, true) // forceImmediate = true
  logger.info({ feedId, feedTitle: feed.title }, "Forced immediate refresh")
}

/**
 * Initialize schedulers for all feeds
 * Called on app startup after user authentication
 */
export async function initializeRSSScheduler(): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      logger.warn("No authenticated user, skipping scheduler initialization")
      return
    }

    const { data: feeds, error } = await supabase
      .from("feeds")
      .select("*")
      .eq("user_id", user.id)

    if (error) {
      logger.error({ error }, "Failed to load feeds for scheduler initialization")
      throw error
    }

    if (!feeds || feeds.length === 0) {
      logger.info("No feeds to schedule")
      return
    }

    logger.info({ feedCount: feeds.length }, "Initializing RSS scheduler")

    // Schedule all feeds
    for (const dbFeed of feeds) {
      const feed: Feed = {
        id: dbFeed.id,
        title: dbFeed.title,
        url: dbFeed.url,
        description: dbFeed.description || undefined,
        category: dbFeed.category || undefined,
        folderId: dbFeed.folder_id || undefined,
        order: dbFeed.order,
        unreadCount: dbFeed.unread_count,
        refreshInterval: dbFeed.refresh_interval,
        lastFetched: dbFeed.last_fetched ? new Date(dbFeed.last_fetched) : undefined,
        lastFetchStatus: dbFeed.last_fetch_status || undefined,
        lastFetchError: dbFeed.last_fetch_error || undefined,
      }

      await scheduleFeedRefresh(feed)
    }

    logger.info({ feedCount: feeds.length }, "RSS scheduler initialized")
  } catch (error) {
    logger.error({ error }, "Failed to initialize RSS scheduler")
    throw error
  }
}

/**
 * Get scheduler statistics
 * Useful for debugging and monitoring
 */
export async function getSchedulerStats(): Promise<{
  queueStats: {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
  }
}> {
  const queue = getRSSQueue()

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ])

  return {
    queueStats: { waiting, active, completed, failed, delayed },
  }
}
