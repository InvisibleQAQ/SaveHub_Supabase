"use client"

import { useState, useEffect, useCallback } from "react"
import { RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRSSStore } from "@/lib/store"
import { parseRSSFeed } from "@/lib/rss-parser"
import { useToast } from "@/hooks/use-toast"
import { useTranslations } from "next-intl"

interface FeedRefreshProps {
  feedId?: string
  className?: string
  /** Listen to global refresh-feeds event (only one instance should set this to true) */
  listenToGlobalEvent?: boolean
}

export function FeedRefresh({ feedId, className, listenToGlobalEvent = false }: FeedRefreshProps) {
  const t = useTranslations("sidebar.refresh")
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { feeds, addArticles, updateFeed } = useRSSStore()
  const { toast } = useToast()

  const refreshFeed = useCallback(async (feed: any) => {
    try {
      const { articles } = await parseRSSFeed(feed.url, feed.id)

      const newArticlesCount = await addArticles(articles)

      await updateFeed(feed.id, { lastFetched: new Date() })

      return newArticlesCount
    } catch (error) {
      console.error(`Error refreshing feed ${feed.title}:`, error)
      throw error
    }
  }, [addArticles, updateFeed])

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return

    setIsRefreshing(true)

    try {
      if (feedId) {
        // Refresh specific feed
        const feed = feeds.find((f) => f.id === feedId)
        if (!feed) {
          throw new Error(t("feedNotFound"))
        }

        const newArticlesCount = await refreshFeed(feed)

        toast({
          title: t("feedRefreshedTitle"),
          description: newArticlesCount === 0
            ? t("feedNoNewArticles", { feedTitle: feed.title })
            : t("feedFoundNewArticles", { articleCount: newArticlesCount, feedTitle: feed.title }),
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
            title: t("allFeedsRefreshedTitle"),
            description: totalNewArticles === 0
              ? t("allFeedsNoNewArticles", { feedCount: successCount })
              : t("allFeedsFoundNewArticles", { articleCount: totalNewArticles, feedCount: successCount }),
          })
        } else {
          toast({
            title: t("feedsRefreshedWithErrorsTitle"),
            description: totalNewArticles === 0
              ? t("partialUpdateNoNewArticles", { successCount, errorCount })
              : t("partialUpdateFoundNewArticles", { successCount, errorCount, articleCount: totalNewArticles }),
            variant: errorCount > successCount ? "destructive" : "default",
          })
        }
      }
    } catch (error) {
      console.error("Error refreshing feeds:", error)
      toast({
        title: t("refreshFailedTitle"),
        description: error instanceof Error ? error.message : feedId ? t("failedToRefreshFeed") : t("failedToRefreshFeeds"),
        variant: "destructive",
      })
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing, feedId, feeds, refreshFeed, toast])

  // Listen for global refresh-feeds event (triggered by Ctrl+R)
  useEffect(() => {
    if (!listenToGlobalEvent) return

    const handleGlobalRefresh = () => {
      handleRefresh()
    }

    document.addEventListener("refresh-feeds", handleGlobalRefresh)
    return () => document.removeEventListener("refresh-feeds", handleGlobalRefresh)
  }, [listenToGlobalEvent, handleRefresh])

  return (
    <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing} className={className}>
      {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
    </Button>
  )
}
