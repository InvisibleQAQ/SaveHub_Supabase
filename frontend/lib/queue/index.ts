/**
 * BullMQ Queue Module Exports
 *
 * ⚠️ SERVER-SIDE ONLY - Do NOT import this in client components!
 *
 * BullMQ depends on Node.js modules (child_process) that don't exist in browsers.
 * For client-side code, use @/lib/scheduler-client instead.
 *
 * This module is used by:
 * - Worker process (lib/queue/worker.ts)
 * - API routes (app/api/scheduler/*)
 *
 * Client-side alternative:
 *   import { scheduleFeedRefresh, cancelFeedRefresh } from '@/lib/scheduler-client'
 */

// Queue utilities (server-side only)
export { getRSSQueue, getQueueStats, closeQueue, clearQueue } from "./rss-queue"

// Redis connections (server-side only)
export { closeAllConnections } from "./redis"

// Types (can be used anywhere)
export type { RSSRefreshTask, TaskResult } from "./schemas"
