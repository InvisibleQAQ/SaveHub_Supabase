/**
 * RSS Feed Scheduler - Pure setTimeout Implementation
 *
 * Core Design:
 * - Calculates next refresh time from historical last_fetched timestamp
 * - Uses recursive setTimeout (NOT interval-based schedulers)
 * - Prevents overlapping executions with runningTasks Set
 * - Automatically reschedules after each execution
 *
 * Key Decision: Pure setTimeout > toad-scheduler
 * Reason: We need "run at last_fetched + N minutes", not "run every N minutes from now"
 */

import type { Feed } from "./types"
import { useRSSStore } from "./store"
import { parseRSSFeed } from "./rss-parser"

// ============================================================================
// State Management
// ============================================================================

/** Maps feedId to active setTimeout ID */
const activeTimeouts = new Map<string, NodeJS.Timeout>()

/** Tracks feeds currently being refreshed (prevents concurrent executions) */
const runningTasks = new Set<string>()

/** Debug mode - only logs in development */
const DEBUG = process.env.NODE_ENV === "development"

// ============================================================================
// Logging Helpers
// ============================================================================

function log(message: string) {
  if (DEBUG) console.log(`[Scheduler] ${message}`)
}

function logError(message: string, error?: any) {
  console.error(`[Scheduler] ${message}`, error)
}

// ============================================================================
// Core Scheduling Logic
// ============================================================================

/**
 * Calculate delay until next refresh based on last_fetched timestamp
 *
 * Formula: delay = max(0, last_fetched + interval - now)
 *
 * Edge cases:
 * - If last_fetched is missing, use current time (immediate refresh)
 * - If delay < 0 (overdue), return 0 (immediate refresh)
 * - If delay > 2^31-1 (~24.8 days), clamp to max safe value
 *
 * @returns Delay in milliseconds until next refresh
 */
function calculateRefreshDelay(feed: Feed): number {
  const now = Date.now()
  const lastFetched = feed.lastFetched?.getTime() || now
  const intervalMs = feed.refreshInterval * 60 * 1000

  // Next refresh time = last_fetched + interval
  const nextRefreshTime = lastFetched + intervalMs

  // Delay = time until next refresh (minimum 0 for overdue feeds)
  const delay = Math.max(0, nextRefreshTime - now)

  // Node.js setTimeout max value: 2,147,483,647 ms (~24.8 days)
  // Our max interval: 10,080 minutes (7 days) = 604,800,000 ms ✅ Safe
  const MAX_TIMEOUT = 2147483647
  return Math.min(delay, MAX_TIMEOUT)
}

/**
 * Get feed by ID from Zustand store
 * Used to re-fetch updated feed data after refresh
 */
function getFeedById(feedId: string): Feed | null {
  const state = useRSSStore.getState()
  return state.feeds.find((f) => f.id === feedId) || null
}

/**
 * Refresh a single feed
 *
 * Steps:
 * 1. Parse RSS feed from URL
 * 2. Add new articles to store (deduplicates by URL)
 * 3. Update last_fetched + status on BOTH success AND failure
 * 4. Failure updates last_fetched to prevent retry storms
 *
 * @returns Result object with success status and optional error message
 */
async function refreshFeed(feed: Feed): Promise<{
  success: boolean
  error?: string
  addedCount?: number
}> {
  const start = Date.now()
  log(`Starting refresh for: ${feed.title}`)

  try {
    // Parse RSS feed
    const { articles } = await parseRSSFeed(feed.url, feed.id)

    // Add new articles to store (deduplicates automatically)
    const addedCount = await useRSSStore.getState().addArticles(articles)

    // Update last_fetched + status on success
    useRSSStore.getState().updateFeed(feed.id, {
      lastFetched: new Date(),
      lastFetchStatus: "success",
      lastFetchError: null,
    })

    const duration = Date.now() - start
    log(`✅ Refreshed ${feed.title} in ${duration}ms (added ${addedCount} new articles)`)
    return { success: true, addedCount }
  } catch (error) {
    const duration = Date.now() - start
    const errorMsg = error instanceof Error ? error.message : String(error)

    // Update last_fetched + status on failure (prevents retry storms)
    useRSSStore.getState().updateFeed(feed.id, {
      lastFetched: new Date(),
      lastFetchStatus: "failed",
      lastFetchError: errorMsg,
    })

    logError(`❌ Failed to refresh ${feed.title} after ${duration}ms:`, error)
    return { success: false, error: errorMsg }
  }
}

/**
 * Schedule a single feed for automatic refresh
 *
 * Behavior:
 * - Cancels existing timeout if already scheduled (idempotent)
 * - Calculates delay from last_fetched + refresh_interval
 * - Prevents overlapping executions (skips if already running)
 * - Automatically reschedules after execution completes (success OR failure)
 * - Treats failure as valid completion (updates last_fetched to prevent retry storms)
 *
 * Edge cases handled:
 * - Feed deleted during refresh: Doesn't reschedule (no memory leak)
 * - Overlapping execution: Skips but reschedules for next run
 * - Network failure: Updates last_fetched + status, retries at next interval
 * - Interval changed mid-execution: New scheduler starts with new interval
 */
export function scheduleFeedRefresh(feed: Feed): void {
  // Cancel existing timeout (makes this function idempotent)
  cancelFeedRefresh(feed.id)

  const delay = calculateRefreshDelay(feed)
  const delaySeconds = Math.round(delay / 1000)

  log(`Scheduling "${feed.title}" to refresh in ${delaySeconds}s (interval: ${feed.refreshInterval} min)`)

  const timeoutId = setTimeout(async () => {
    // Prevent overlapping executions
    if (runningTasks.has(feed.id)) {
      log(`Feed ${feed.id} still running, skipping this execution`)
      // Reschedule anyway to keep scheduler alive
      const currentFeed = getFeedById(feed.id)
      if (currentFeed) {
        scheduleFeedRefresh(currentFeed)
      }
      return
    }

    runningTasks.add(feed.id)

    try {
      // refreshFeed() never throws - it returns {success, error}
      await refreshFeed(feed)

      // Success or failure doesn't matter - both update last_fetched
      // Reschedule with updated feed data (includes new last_fetched + status)
      const updatedFeed = getFeedById(feed.id)
      if (updatedFeed) {
        scheduleFeedRefresh(updatedFeed)
      } else {
        log(`Feed ${feed.id} not found after refresh (possibly deleted)`)
      }
    } finally {
      runningTasks.delete(feed.id)
    }
  }, delay)

  activeTimeouts.set(feed.id, timeoutId)
}

/**
 * Cancel scheduled refresh for a feed
 * Safe to call even if feed isn't scheduled (idempotent)
 */
export function cancelFeedRefresh(feedId: string): void {
  const timeoutId = activeTimeouts.get(feedId)
  if (timeoutId) {
    clearTimeout(timeoutId)
    activeTimeouts.delete(feedId)
    log(`Cancelled scheduler for feed ${feedId}`)
  }
}

/**
 * Initialize schedulers for all feeds
 * Called on app startup after data is loaded from database
 */
export async function initializeScheduler(): Promise<void> {
  log("Initializing feed schedulers...")

  const feeds = useRSSStore.getState().feeds

  if (feeds.length === 0) {
    log("No feeds to schedule")
    return
  }

  // Schedule all feeds in parallel
  feeds.forEach((feed) => {
    scheduleFeedRefresh(feed)
  })

  log(`✅ Initialized ${feeds.length} feed schedulers`)
}

/**
 * Stop all active schedulers
 * Called on app shutdown (SIGTERM/SIGINT) for graceful cleanup
 */
export function stopAllSchedulers(): void {
  log("Stopping all schedulers...")

  // Clear all active timeouts
  activeTimeouts.forEach((timeoutId, feedId) => {
    clearTimeout(timeoutId)
    log(`Stopped scheduler for feed ${feedId}`)
  })

  activeTimeouts.clear()
  runningTasks.clear()

  log("✅ All schedulers stopped")
}

/**
 * Get current scheduler statistics
 * Useful for debugging and monitoring
 */
export function getSchedulerStats() {
  return {
    activeSchedulers: activeTimeouts.size,
    runningTasks: runningTasks.size,
    scheduledFeedIds: Array.from(activeTimeouts.keys()),
    runningFeedIds: Array.from(runningTasks),
  }
}

/**
 * Force immediate refresh of a feed (bypasses schedule)
 * Useful for manual "Refresh Now" button
 */
export async function forceRefreshFeed(feedId: string): Promise<void> {
  const feed = getFeedById(feedId)
  if (!feed) {
    throw new Error(`Feed ${feedId} not found`)
  }

  // Cancel existing schedule
  cancelFeedRefresh(feedId)

  // Refresh immediately
  if (runningTasks.has(feedId)) {
    log(`Feed ${feedId} already running, skipping force refresh`)
    return
  }

  runningTasks.add(feedId)
  try {
    await refreshFeed(feed)
    // Reschedule after successful refresh
    const updatedFeed = getFeedById(feedId)
    if (updatedFeed) {
      scheduleFeedRefresh(updatedFeed)
    }
  } finally {
    runningTasks.delete(feedId)
  }
}

// ============================================================================
// Graceful Shutdown Handlers
// ============================================================================

if (typeof process !== "undefined") {
  process.on("SIGTERM", () => {
    log("Received SIGTERM signal")
    stopAllSchedulers()
    process.exit(0)
  })

  process.on("SIGINT", () => {
    log("Received SIGINT signal")
    stopAllSchedulers()
    process.exit(0)
  })
}
