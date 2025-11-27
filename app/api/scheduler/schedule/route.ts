/**
 * API Route: Schedule Feed Refresh
 *
 * POST /api/scheduler/schedule
 * Body: { feed: Feed }
 *
 * This route runs on the server, so it can safely use BullMQ
 */

import { type NextRequest, NextResponse } from "next/server"
import { Queue } from "bullmq"
import { Redis } from "ioredis"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { z } from "zod"

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

// ============================================================================
// Route Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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
        jobId: `feed-${feed.id}`,
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
