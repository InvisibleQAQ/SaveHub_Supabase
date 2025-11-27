/**
 * RSS Refresh Queue Instance
 *
 * Single BullMQ queue for all RSS refresh tasks
 *
 * Why single queue?
 * - All RSS tasks have similar characteristics (I/O bound, similar duration)
 * - Priority system handles urgent vs normal tasks
 * - Simplifies monitoring (one queue to watch)
 */

import { Queue } from "bullmq"
import { getQueueConnection } from "./redis"
import type { RSSRefreshTask } from "./schemas"

const QUEUE_NAME = "rss-refresh"

// Lazy initialization to avoid Redis connection on module import
let _queue: Queue<RSSRefreshTask> | null = null

/**
 * Get the RSS refresh queue instance
 * Creates queue on first access (lazy initialization)
 */
export function getRSSQueue(): Queue<RSSRefreshTask> {
  if (!_queue) {
    _queue = new Queue<RSSRefreshTask>(QUEUE_NAME, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        // Retry configuration
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000, // 2s, 4s, 8s
        },

        // Job cleanup
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000, // Keep at most 1000 completed jobs
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      },
    })
  }
  return _queue
}

/**
 * Close the queue connection
 * Call this on shutdown
 */
export async function closeQueue(): Promise<void> {
  if (_queue) {
    await _queue.close()
    _queue = null
  }
}

/**
 * Get queue statistics
 * Useful for monitoring dashboard
 */
export async function getQueueStats(): Promise<{
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}> {
  const queue = getRSSQueue()

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ])

  return { waiting, active, completed, failed, delayed }
}

/**
 * Clear all jobs from the queue
 * ⚠️ DANGER: Use only for testing or maintenance
 */
export async function clearQueue(): Promise<void> {
  const queue = getRSSQueue()
  await queue.obliterate({ force: true })
}
