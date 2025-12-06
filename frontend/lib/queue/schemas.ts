/**
 * Job Payload Schemas for BullMQ Tasks
 *
 * Type-safe job payloads with Zod validation
 * Ensures data integrity across producer and consumer
 */

import { z } from "zod"

/**
 * RSS Refresh Task Schema
 *
 * Contains all data needed to refresh a feed:
 * - Feed identification (feedId, feedUrl)
 * - User ownership (userId) - Required for DB operations in worker
 * - Scheduling context (lastFetched, refreshInterval)
 * - Priority level for queue ordering
 */
export const RSSRefreshTaskSchema = z.object({
  feedId: z.string().uuid(),
  feedUrl: z.string().url(),
  feedTitle: z.string(),
  userId: z.string().uuid(),
  lastFetched: z.coerce.date().nullable(),
  refreshInterval: z.number().int().min(1).max(10080),
  priority: z.enum(["manual", "overdue", "normal"]).default("normal"),
})

export type RSSRefreshTask = z.infer<typeof RSSRefreshTaskSchema>

/**
 * Task Result Schema
 * Returned by worker after processing
 */
export const TaskResultSchema = z.object({
  success: z.boolean(),
  articleCount: z.number().optional(),
  error: z.string().optional(),
  duration: z.number(), // milliseconds
})

export type TaskResult = z.infer<typeof TaskResultSchema>

/**
 * Validate job payload at runtime
 * Throws ZodError if validation fails
 */
export function validateTask(data: unknown): RSSRefreshTask {
  return RSSRefreshTaskSchema.parse(data)
}

/**
 * Safe validation that returns result instead of throwing
 */
export function safeValidateTask(data: unknown): {
  success: boolean
  data?: RSSRefreshTask
  error?: z.ZodError
} {
  const result = RSSRefreshTaskSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Priority levels as numeric values for BullMQ
 * Lower number = higher priority
 */
export const PriorityLevel = {
  manual: 1, // User clicked "Refresh Now"
  overdue: 2, // Feed missed schedule (>2x interval)
  normal: 5, // Regular scheduled refresh
} as const
