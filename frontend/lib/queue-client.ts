/**
 * Celery Queue Client
 *
 * Calls FastAPI backend endpoints to schedule/cancel feed refreshes.
 * Replaces BullMQ-based scheduler-client.ts after Phase 2 migration.
 *
 * API Endpoints (via /api/backend/* rewrite):
 * - POST /api/backend/queue/schedule-feed
 * - GET  /api/backend/queue-health
 * - GET  /api/backend/queue/task/{task_id}
 */

// ============================================================================
// Types
// ============================================================================

export interface ScheduleFeedResponse {
  task_id: string | null
  status: "scheduled" | "already_running" | "queued"
  delay_seconds: number
}

export interface QueueHealth {
  status: "healthy" | "degraded"
  redis_connected: boolean
  queues: {
    default: number
    high: number
  }
  total_pending: number
  checked_at: string
}

export interface TaskStatus {
  task_id: string
  status: string
  result?: unknown
  error?: string
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Schedule a feed for automatic refresh via Celery
 *
 * @param feedId - UUID of the feed to schedule
 * @param forceImmediate - If true, refresh immediately (high priority queue)
 * @returns Task scheduling result
 */
export async function scheduleFeedRefresh(
  feedId: string,
  forceImmediate = false
): Promise<ScheduleFeedResponse> {
  const response = await fetch("/api/backend/queue/schedule-feed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include", // Send HttpOnly cookies
    body: JSON.stringify({
      feed_id: feedId,
      force_immediate: forceImmediate,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage = errorData.detail || `HTTP ${response.status}`
    throw new Error(`Failed to schedule feed refresh: ${errorMessage}`)
  }

  return response.json()
}

/**
 * Cancel scheduled refresh for a feed
 *
 * Note: Celery doesn't have native job cancellation like BullMQ.
 * This is a no-op in Celery - tasks with locks will naturally skip.
 * Kept for API compatibility with existing code.
 */
export async function cancelFeedRefresh(feedId: string): Promise<void> {
  // Celery task deduplication uses Redis locks, not job cancellation.
  // When a feed is deleted, the lock expires naturally (3 min TTL).
  // No API call needed - this is intentionally a no-op.
  console.debug(
    `[queue-client] Cancel request for feed ${feedId} (no-op in Celery)`
  )
}

/**
 * Force immediate refresh of a feed
 * Alias for scheduleFeedRefresh with forceImmediate=true
 */
export async function forceRefreshFeed(
  feedId: string
): Promise<ScheduleFeedResponse> {
  return scheduleFeedRefresh(feedId, true)
}

/**
 * Get queue health status
 */
export async function getQueueHealth(): Promise<QueueHealth> {
  const response = await fetch("/api/backend/queue-health", {
    credentials: "include",
  })

  if (!response.ok) {
    throw new Error("Failed to get queue health")
  }

  return response.json()
}

/**
 * Get task status by ID
 */
export async function getTaskStatus(taskId: string): Promise<TaskStatus> {
  const response = await fetch(`/api/backend/queue/task/${taskId}`, {
    credentials: "include",
  })

  if (!response.ok) {
    throw new Error("Failed to get task status")
  }

  return response.json()
}
