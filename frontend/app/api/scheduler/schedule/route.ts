/**
 * API Route: Schedule Feed Refresh
 *
 * POST /api/scheduler/schedule
 * Body: { feed: Feed }
 *
 * This route runs on the server, so it can safely use BullMQ
 *
 * Phase 1 Migration: Dual-write to both BullMQ and Celery
 * - BullMQ is the primary queue (must succeed)
 * - Celery is async dual-write (fire-and-forget, failures are silent)
 * - Controlled by ENABLE_CELERY_DUAL_WRITE env var
 */

import { type NextRequest, NextResponse } from "next/server"
import { Queue } from "bullmq"
import { Redis } from "ioredis"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { z } from "zod"

// ============================================================================
// Celery Dual-Write Configuration
// ============================================================================

const ENABLE_CELERY_DUAL_WRITE = process.env.ENABLE_CELERY_DUAL_WRITE === "true"
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000"

// ============================================================================
// Redis & Queue (lazy initialization)
// ============================================================================

let redis: Redis | null = null
let queue: Queue | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
  }
  return redis
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue("rss-refresh", {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    })
  }
  return queue
}

// ============================================================================
// Request Schema
// ============================================================================

const ScheduleRequestSchema = z.object({
  feed: z.object({
    id: z.string(),
    url: z.string(),
    title: z.string(),
    refreshInterval: z.number(),
    lastFetched: z.string().nullable().optional(),
  }),
  forceImmediate: z.boolean().optional().default(false),
})

// ============================================================================
// Helper Functions
// ============================================================================

function calculateRefreshDelay(
  lastFetched: Date | null,
  refreshInterval: number
): number {
  const now = Date.now()
  const lastFetchedTime = lastFetched?.getTime() || now
  const intervalMs = refreshInterval * 60 * 1000
  const nextRefreshTime = lastFetchedTime + intervalMs
  return Math.max(0, nextRefreshTime - now)
}

function calculatePriority(
  lastFetched: Date | null,
  refreshInterval: number,
  forceImmediate: boolean
): { priority: "manual" | "overdue" | "normal"; numericPriority: number } {
  if (forceImmediate) {
    return { priority: "manual", numericPriority: 1 }
  }

  const delay = calculateRefreshDelay(lastFetched, refreshInterval)

  if (delay === 0 && lastFetched) {
    const now = Date.now()
    const overdueThreshold = refreshInterval * 60 * 1000 * 2
    if (now - lastFetched.getTime() > overdueThreshold) {
      return { priority: "overdue", numericPriority: 2 }
    }
  }

  return { priority: "normal", numericPriority: 5 }
}

/**
 * Dual-write to Celery backend (async, non-blocking)
 *
 * This function is fire-and-forget:
 * - Does not block the main BullMQ flow
 * - Failures are logged but don't affect the response
 * - Used during Phase 1 migration to validate Celery correctness
 */
async function scheduleFeedViaCelery(
  feedId: string,
  forceImmediate: boolean,
  accessToken: string
): Promise<void> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/queue/schedule-feed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        feed_id: feedId,
        force_immediate: forceImmediate,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.warn(
        { feedId, status: response.status, error: errorText },
        "[Celery Dual-Write] API request failed"
      )
      return
    }

    const result = await response.json()
    logger.info(
      { feedId, taskId: result.task_id, status: result.status },
      "[Celery Dual-Write] Task scheduled"
    )
  } catch (error) {
    logger.warn(
      { feedId, error: String(error) },
      "[Celery Dual-Write] Unexpected error"
    )
  }
}

// ============================================================================
// Route Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user and session
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get session for Celery dual-write (need access_token)
    const {
      data: { session },
    } = await supabase.auth.getSession()

    // Parse and validate request
    const body = await request.json()
    const { feed, forceImmediate } = ScheduleRequestSchema.parse(body)

    // Calculate delay and priority
    const lastFetched = feed.lastFetched ? new Date(feed.lastFetched) : null
    const delay = forceImmediate ? 0 : calculateRefreshDelay(lastFetched, feed.refreshInterval)
    const { priority, numericPriority } = calculatePriority(
      lastFetched,
      feed.refreshInterval,
      forceImmediate
    )

    // Add job to queue
    const rssQueue = getQueue()
    const jobId = `feed-${feed.id}`

    // Remove existing job first (BullMQ doesn't auto-replace jobs with same jobId)
    try {
      const existingJob = await rssQueue.getJob(jobId)
      if (existingJob) {
        await existingJob.remove()
        logger.debug({ feedId: feed.id }, "Removed existing scheduled job")
      }
    } catch (removeError) {
      // Job might be active or already removed, continue anyway
      logger.debug({ feedId: feed.id, error: removeError }, "Could not remove existing job")
    }

    // Add new job with updated data
    await rssQueue.add(
      "refresh",
      {
        feedId: feed.id,
        feedUrl: feed.url,
        feedTitle: feed.title,
        userId: user.id,
        lastFetched: feed.lastFetched,
        refreshInterval: feed.refreshInterval,
        priority,
      },
      {
        jobId,
        delay,
        priority: numericPriority,
      }
    )

    const delaySeconds = Math.round(delay / 1000)
    logger.info(
      {
        feedId: feed.id,
        feedTitle: feed.title,
        delaySeconds,
        priority,
        userId: user.id,
      },
      `Scheduled feed refresh in ${delaySeconds}s`
    )

    // === Phase 1: Celery Dual-Write (async, non-blocking) ===
    if (ENABLE_CELERY_DUAL_WRITE && session?.access_token) {
      // Fire-and-forget: don't await, errors are logged but don't affect response
      scheduleFeedViaCelery(feed.id, forceImmediate, session.access_token).catch(
        (error) => {
          logger.warn({ feedId: feed.id, error }, "Celery dual-write failed")
        }
      )
    }

    return NextResponse.json({
      success: true,
      delaySeconds,
      priority,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: error.errors },
        { status: 400 }
      )
    }

    logger.error({ error }, "Failed to schedule feed refresh")
    return NextResponse.json(
      { error: "Failed to schedule feed refresh" },
      { status: 500 }
    )
  }
}
