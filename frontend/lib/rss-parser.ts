import type { Article } from "./types"
import { supabase } from "./supabase/client"

export interface ParsedFeed {
  title: string
  description: string
  link: string
  image?: string
}

/**
 * Get current user's access token for API authentication
 */
async function getAccessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) {
    throw new Error("Not authenticated. Please sign in to continue.")
  }
  return session.access_token
}

export async function parseRSSFeed(url: string, feedId: string): Promise<{ feed: ParsedFeed; articles: Article[] }> {
  try {
    const accessToken = await getAccessToken()

    const response = await fetch("/api/backend/rss/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ url, feedId }),
    })

    if (!response.ok) {
      let errorMessage = "Failed to parse RSS feed"
      try {
        const errorData = await response.json()
        errorMessage = errorData.detail || errorData.error || errorMessage
      } catch {
        // Response is not JSON (e.g., "Internal Server Error" text)
        errorMessage = `Server error (${response.status}): Backend may not be running`
      }
      throw new Error(errorMessage)
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
    const accessToken = await getAccessToken()

    const response = await fetch("/api/backend/rss/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
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
