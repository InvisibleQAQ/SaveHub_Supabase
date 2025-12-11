import { type NextRequest, NextResponse } from "next/server"
import Parser from "rss-parser"
import { logger } from "@/lib/logger"

const parser = new Parser({
  customFields: {
    feed: ["image"],
    item: ["media:thumbnail", "media:content", "enclosure", "description", "content:encoded"],
  },
})

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  // ✅ Declare outside try block so catch can access them
  let url: string | undefined
  let feedId: string | undefined

  try {
    const body = await request.json()
    url = body.url
    feedId = body.feedId

    if (!url || !feedId) {
      logger.warn({ url, feedId }, 'RSS parse request missing URL or feedId')
      return NextResponse.json({ error: "URL and feedId are required" }, { status: 400 })
    }

    logger.info({ url, feedId }, 'Parsing RSS feed')

    // Parse the RSS feed
    const feed = await parser.parseURL(url)

    const parsedFeed = {
      title: feed.title || new URL(url).hostname,
      description: feed.description || "",
      link: feed.link || url,
      image: feed.image?.url || feed.image,
    }

    const articles = feed.items.map((item) => {
      // Extract thumbnail from various sources
      let thumbnail: string | undefined

      if (item["media:thumbnail"]) {
        thumbnail = Array.isArray(item["media:thumbnail"])
          ? item["media:thumbnail"][0]?.url || item["media:thumbnail"][0]
          : item["media:thumbnail"].url || item["media:thumbnail"]
      } else if (item["media:content"]) {
        thumbnail = Array.isArray(item["media:content"]) ? item["media:content"][0]?.url : item["media:content"].url
      } else if (item.enclosure && item.enclosure.type?.startsWith("image/")) {
        thumbnail = item.enclosure.url
      }

      const articleId = crypto.randomUUID()

      // Clean content
      const content = item.content || item["content:encoded"] || item.description || item.summary || ""
      const summary = item.contentSnippet || item.summary || item.description || ""

      return {
        id: articleId,
        feedId,
        title: item.title || "Untitled",
        content: content,
        summary: summary.length > 200 ? summary.substring(0, 200) + "..." : summary,
        url: item.link || "",
        author: item.creator || (item as any).author,
        publishedAt: new Date(item.pubDate || item.isoDate || Date.now()),
        isRead: false,
        isStarred: false,
        thumbnail,
      }
    })

    const duration = Date.now() - startTime
    logger.info({ url, feedId, articleCount: articles.length, duration }, 'RSS feed parsed successfully')

    return NextResponse.json({ feed: parsedFeed, articles })
  } catch (error) {
    const duration = Date.now() - startTime

    // ✅ Now we have proper error serialization + context
    logger.error(
      {
        error,           // Will be properly serialized by pino.stdSerializers.err
        url,             // Now accessible from outer scope
        feedId,          // Now accessible from outer scope
        duration,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      'Failed to parse RSS feed'
    )

    return NextResponse.json(
      { error: `Failed to parse RSS feed: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    )
  }
}
