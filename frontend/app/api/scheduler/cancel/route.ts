/**
 * API Route: Cancel Feed Refresh
 *
 * POST /api/scheduler/cancel
 * Body: { feedId: string }
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
    })
  }
  return queue
}

// ============================================================================
// Request Schema
// ============================================================================

const CancelRequestSchema = z.object({
  feedId: z.string(),
})

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
    const { feedId } = CancelRequestSchema.parse(body)

    // Remove job from queue
    const rssQueue = getQueue()
    const jobId = `feed-${feedId}`
    const job = await rssQueue.getJob(jobId)

    if (job) {
      await job.remove()
      logger.info({ feedId, userId: user.id }, "Cancelled feed refresh")
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: error.errors },
        { status: 400 }
      )
    }

    logger.error({ error }, "Failed to cancel feed refresh")
    // Don't throw - cancellation failure shouldn't break delete flow
    return NextResponse.json({ success: true })
  }
}
