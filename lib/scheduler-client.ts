/**
 * Client-side Scheduler API
 *
 * These functions call the server-side API routes to schedule/cancel
 * feed refreshes. Use these in client components and store actions.
 *
 * Why not import BullMQ directly?
 * - BullMQ depends on Node.js modules (child_process)
 * - Client-side code runs in browser, which doesn't have these modules
 * - Solution: Call API routes that run on server
 */

import type { Feed } from "./types"

/**
 * Schedule a feed for automatic refresh
 *
 * @param feed - Feed to schedule
 * @param forceImmediate - If true, refresh immediately (for "Refresh Now" button)
 */
export async function scheduleFeedRefresh(
  feed: Feed,
  forceImmediate = false
): Promise<void> {
  const response = await fetch("/api/scheduler/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      feed: {
        id: feed.id,
        url: feed.url,
        title: feed.title,
        refreshInterval: feed.refreshInterval,
        lastFetched: feed.lastFetched?.toISOString() || null,
      },
      forceImmediate,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || "Failed to schedule feed refresh")
  }
}

/**
 * Cancel scheduled refresh for a feed
 * Safe to call even if feed isn't scheduled (idempotent)
 */
export async function cancelFeedRefresh(feedId: string): Promise<void> {
  const response = await fetch("/api/scheduler/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedId }),
  })

  // Don't throw on error - cancellation failure shouldn't break delete flow
  if (!response.ok) {
    console.error("Failed to cancel feed refresh:", await response.text())
  }
}

/**
 * Force immediate refresh of a feed (bypasses schedule)
 * Used for "Refresh Now" button
 */
export async function forceRefreshFeed(feed: Feed): Promise<void> {
  await scheduleFeedRefresh(feed, true)
}
