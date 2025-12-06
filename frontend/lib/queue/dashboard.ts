/**
 * Bull Board Dashboard Server
 *
 * A standalone Express server that provides a web UI for monitoring BullMQ queues.
 *
 * Run with: pnpm dashboard
 * Access at: http://localhost:3001/admin/queues
 *
 * Features:
 * - View all jobs (waiting, active, completed, failed, delayed)
 * - Retry failed jobs
 * - Delete jobs
 * - View job details (payload, logs, stack traces)
 * - Real-time updates
 */

import express from "express"
import { createBullBoard } from "@bull-board/api"
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter"
import { ExpressAdapter } from "@bull-board/express"
import { Queue } from "bullmq"
import { Redis } from "ioredis"

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.DASHBOARD_PORT || 3001
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
const BASE_PATH = "/admin/queues"

// ============================================================================
// Redis Connection
// ============================================================================

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

redis.on("connect", () => {
  console.log("✅ Redis connected")
})

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message)
})

// ============================================================================
// Queue Instances
// ============================================================================

const rssRefreshQueue = new Queue("rss-refresh", { connection: redis })

// ============================================================================
// Bull Board Setup
// ============================================================================

const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath(BASE_PATH)

createBullBoard({
  queues: [new BullMQAdapter(rssRefreshQueue)],
  serverAdapter,
})

// ============================================================================
// Express Server
// ============================================================================

const app = express()

// Mount Bull Board
app.use(BASE_PATH, serverAdapter.getRouter())

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    redis: redis.status,
    queues: ["rss-refresh"],
  })
})

// Root redirect
app.get("/", (req, res) => {
  res.redirect(BASE_PATH)
})

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                    🎛️  Bull Board Dashboard                        ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  Dashboard:  http://localhost:${PORT}${BASE_PATH}               ║
║  Health:     http://localhost:${PORT}/health                         ║
║                                                                    ║
║  Features:                                                         ║
║  • View all queued jobs                                            ║
║  • Monitor active/completed/failed jobs                            ║
║  • Retry failed jobs                                               ║
║  • Delete jobs                                                     ║
║  • View job details and logs                                       ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
  `)
})

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`)

  await rssRefreshQueue.close()
  await redis.quit()

  console.log("👋 Dashboard closed")
  process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
