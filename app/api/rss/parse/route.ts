import { type NextRequest, NextResponse } from "next/server"
import Parser from "rss-parser"

const parser = new Parser({
  customFields: {
    feed: ["image"],
    item: ["media:thumbnail", "media:content", "enclosure", "description"],
  },
})

export async function POST(request: NextRequest) {
  try {
    const { url, feedId } = await request.json()

    if (!url || !feedId) {
      return NextResponse.json({ error: "URL and feedId are required" }, { status: 400 })
    }

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
        author: item.creator || item.author || item["dc:creator"],
        publishedAt: new Date(item.pubDate || item.isoDate || Date.now()),
        isRead: false,
        isStarred: false,
        thumbnail,
      }
    })

    return NextResponse.json({ feed: parsedFeed, articles })
  } catch (error) {
    console.error("Error parsing RSS feed:", error)
    return NextResponse.json(
      { error: `Failed to parse RSS feed: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    )
  }
}
