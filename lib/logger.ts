import pino from 'pino'

/**
 * Pino logger singleton
 *
 * ⚠️ ARCHITECTURE NOTE: NO pino-pretty transport in Next.js
 * Reason: Worker threads are incompatible with Next.js hot reload and Webpack bundling
 * Error: "Cannot find module '.next/server/vendor-chunks/lib/worker.js'"
 *
 * Solution:
 * - Development: JSON output (readable enough with proper formatting)
 * - Production: JSON output (standard for log aggregators)
 *
 * Features:
 * - Auto redacts sensitive fields (apiKey, api_key, password, token)
 * - Timestamps included
 * - Error stack traces preserved
 *
 * Usage:
 *   logger.info({ userId: '123', feedId: 'abc' }, 'Feed refreshed')
 *   logger.error({ error, feedUrl: url }, 'Feed refresh failed')
 */
export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',

  // ✅ NO TRANSPORT - Avoids worker thread crashes in Next.js
  // JSON output works for both dev and prod

  // Auto-add environment context
  base: {
    env: process.env.NODE_ENV,
  },

  // Redact sensitive fields
  redact: {
    paths: [
      'apiKey',
      'api_key',
      'password',
      'token',
      'secret',
      'ENCRYPTION_SECRET',
      '*.apiKey',
      '*.api_key',
      '*.password',
      '*.token',
    ],
    censor: '***REDACTED***',
  },

  // ✅ Serialize Error objects properly
  // Without this, JSON.stringify(new Error("test")) returns {}
  serializers: {
    error: pino.stdSerializers.err,  // Extracts message, stack, type, etc.
    err: pino.stdSerializers.err,    // Support both naming conventions
  },

  // Better timestamps and error serialization
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() }
    },
  },
})
