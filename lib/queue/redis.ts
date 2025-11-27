/**
 * Redis Connection Singleton for BullMQ
 *
 * Key Design:
 * - Single Redis connection shared across Queue and Worker
 * - Connection pooling handled by ioredis
 * - Graceful shutdown on process termination
 */

import { Redis } from "ioredis"
import { logger } from "../logger"

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

/**
 * Create Redis connection with proper settings for BullMQ
 */
function createRedisConnection(): Redis {
  logger.info({ redisUrl: REDIS_URL.replace(/\/\/.*@/, "//***@") }, "Creating Redis connection")

  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000)
      logger.warn({ attempt: times, delay }, "Redis connection retry")
      return delay
    },
  })

  redis.on("connect", () => {
    logger.info("Redis connected")
  })

  redis.on("error", (err) => {
    logger.error({ error: err }, "Redis connection error")
  })

  redis.on("close", () => {
    logger.info("Redis connection closed")
  })

  return redis
}

// Singleton connection for Queue operations
let queueConnection: Redis | null = null

// Separate connection for Worker operations (BullMQ recommendation)
let workerConnection: Redis | null = null

/**
 * Get Redis connection for Queue operations (adding jobs, checking status)
 */
export function getQueueConnection(): Redis {
  if (!queueConnection) {
    queueConnection = createRedisConnection()
  }
  return queueConnection
}

/**
 * Get Redis connection for Worker operations (processing jobs)
 * BullMQ recommends separate connections for Queue and Worker
 */
export function getWorkerConnection(): Redis {
  if (!workerConnection) {
    workerConnection = createRedisConnection()
  }
  return workerConnection
}

/**
 * Gracefully close all Redis connections
 * Call this on process shutdown
 */
export async function closeAllConnections(): Promise<void> {
  logger.info("Closing all Redis connections...")

  const closePromises: Promise<void>[] = []

  if (queueConnection) {
    closePromises.push(
      queueConnection.quit().then(() => {
        queueConnection = null
        logger.info("Queue Redis connection closed")
      })
    )
  }

  if (workerConnection) {
    closePromises.push(
      workerConnection.quit().then(() => {
        workerConnection = null
        logger.info("Worker Redis connection closed")
      })
    )
  }

  await Promise.all(closePromises)
  logger.info("All Redis connections closed")
}

// Register graceful shutdown handlers
if (typeof process !== "undefined") {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal, closing Redis connections")
    await closeAllConnections()
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}
