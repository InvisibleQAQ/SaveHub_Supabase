"use client"

import { useState } from "react"
import { RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRSSStore } from "@/lib/store"
import { parseRSSFeed } from "@/lib/rss-parser"
import { useToast } from "@/hooks/use-toast"

interface FeedRefreshProps {
  feedId?: string
  className?: string
}

export function FeedRefresh({ feedId, className }: FeedRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { feeds, addArticles, updateFeed } = useRSSStore()
  const { toast } = useToast()

  const refreshFeed = async (feed: any) => {
    try {
      const { articles } = await parseRSSFeed(feed.url, feed.id)

      const newArticlesCount = addArticles(articles)

      updateFeed(feed.id, { lastFetched: new Date() })

      return newArticlesCount
    } catch (error) {
      console.error(`Error refreshing feed ${feed.title}:`, error)
      throw error
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)

    try {
      if (feedId) {
        // Refresh specific feed
        const feed = feeds.find((f) => f.id === feedId)
        if (!feed) {
          throw new Error("Feed not found")
        }

        const newArticlesCount = await refreshFeed(feed)

        toast({
          title: "Feed refreshed",
          description: newArticlesCount === 0
            ? `"${feed.title}" has no new articles`
            : `Found ${newArticlesCount} new article${newArticlesCount > 1 ? 's' : ''} in "${feed.title}"`,
        })
      } else {
        // Refresh all feeds
        let totalNewArticles = 0
        let successCount = 0
        let errorCount = 0

        for (const feed of feeds) {
          try {
            const newArticlesCount = await refreshFeed(feed)
            totalNewArticles += newArticlesCount
            successCount++
          } catch (error) {
            errorCount++
            console.error(`Failed to refresh ${feed.title}:`, error)
          }
        }

        if (errorCount === 0) {
          toast({
            title: "All feeds refreshed",
            description: totalNewArticles === 0
              ? `No new articles found across ${successCount} feed${successCount > 1 ? 's' : ''}`
              : `Found ${totalNewArticles} new article${totalNewArticles > 1 ? 's' : ''} across ${successCount} feed${successCount > 1 ? 's' : ''}`,
          })
        } else {
          toast({
            title: "Feeds refreshed with errors",
            description: totalNewArticles === 0
              ? `${successCount} feed${successCount > 1 ? 's' : ''} updated, ${errorCount} failed. No new articles found.`
              : `${successCount} feed${successCount > 1 ? 's' : ''} updated, ${errorCount} failed. Found ${totalNewArticles} new article${totalNewArticles > 1 ? 's' : ''}.`,
            variant: errorCount > successCount ? "destructive" : "default",
          })
        }
      }
    } catch (error) {
      console.error("Error refreshing feeds:", error)
      toast({
        title: "Refresh failed",
        description: error instanceof Error ? error.message : "Failed to refresh feeds",
        variant: "destructive",
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing} className={className}>
      {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
    </Button>
  )
}
