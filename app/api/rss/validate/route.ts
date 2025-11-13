import { type NextRequest, NextResponse } from "next/server"
import Parser from "rss-parser"
import { logger } from "@/lib/logger"

const parser = new Parser()

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const { url } = await request.json()

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
    logger.warn({ error, url: request.url, duration }, 'RSS feed validation failed')
    return NextResponse.json({ valid: false })
  }
}
