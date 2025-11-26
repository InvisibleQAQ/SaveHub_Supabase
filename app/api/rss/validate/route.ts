import { type NextRequest, NextResponse } from "next/server"
import Parser from "rss-parser"
import { logger } from "@/lib/logger"

const parser = new Parser()

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  // ✅ Declare outside try block so catch can access it
  let url: string | undefined

  try {
    const body = await request.json()
    url = body.url

    if (!url) {
      logger.warn({ url }, 'RSS validate request missing URL')
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    logger.info({ url }, 'Validating RSS feed')

    // Try to parse the RSS feed to validate it
    await parser.parseURL(url)

    const duration = Date.now() - startTime
    logger.info({ url, duration }, 'RSS feed validated successfully')

    return NextResponse.json({ valid: true })
  } catch (error) {
    const duration = Date.now() - startTime

    // ✅ Now we have proper error serialization + context
    logger.warn(
      {
        error,           // Will be properly serialized by pino.stdSerializers.err
        url,             // Now accessible from outer scope
        duration,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      'RSS feed validation failed'
    )

    return NextResponse.json({ valid: false })
  }
}
