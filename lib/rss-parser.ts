import type { Article } from "./types"

export interface ParsedFeed {
  title: string
  description: string
  link: string
  image?: string
}

export async function parseRSSFeed(url: string, feedId: string): Promise<{ feed: ParsedFeed; articles: Article[] }> {
  try {
    const response = await fetch("/api/rss/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, feedId }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || "Failed to parse RSS feed")
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error("Error parsing RSS feed:", error)
    throw new Error(`Failed to parse RSS feed: ${error instanceof Error ? error.message : "Unknown error"}`)
  }
}

export async function validateRSSUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch("/api/rss/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    })

    if (!response.ok) {
      return false
    }

    const data = await response.json()
    return data.valid
  } catch {
    return false
  }
}

// Common RSS feed discovery patterns
export function discoverRSSFeeds(url: string): string[] {
  const baseUrl = new URL(url).origin
  const possibleFeeds = [
    url,
    `${baseUrl}/feed`,
    `${baseUrl}/feed.xml`,
    `${baseUrl}/rss`,
    `${baseUrl}/rss.xml`,
    `${baseUrl}/atom.xml`,
    `${baseUrl}/feeds/all.atom.xml`,
    `${baseUrl}/index.xml`,
  ]

  return possibleFeeds
}
