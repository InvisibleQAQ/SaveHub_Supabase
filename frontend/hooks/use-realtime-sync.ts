"use client"

import { useEffect } from "react"
import { realtimeWSManager } from "@/lib/realtime-ws"
import { useRSSStore } from "@/lib/store"
import type { Feed, Article, Folder } from "@/lib/types"

export function useRealtimeSync() {
  const store = useRSSStore()

  useEffect(() => {
    console.log("[WS] Setting up real-time subscriptions")

    // Subscribe to feeds changes
    realtimeWSManager.subscribeToFeeds(
      (feedRow) => {
        const feed: Feed = {
          id: feedRow.id,
          title: feedRow.title,
          url: feedRow.url,
          description: feedRow.description || undefined,
          category: feedRow.category || undefined,
          folderId: feedRow.folder_id || undefined,
          order: feedRow.order ?? 0,
          unreadCount: feedRow.unread_count,
          refreshInterval: feedRow.refresh_interval,
          lastFetched: feedRow.last_fetched ? new Date(feedRow.last_fetched) : undefined,
        }
        const result = store.addFeed(feed)
        if (!result.success) {
          console.log("[WS] Realtime: Feed already exists, skipping:", feed.url)
        }
      },
      (feedRow) => {
        const feed: Partial<Feed> = {
          title: feedRow.title,
          url: feedRow.url,
          description: feedRow.description || undefined,
          category: feedRow.category || undefined,
          folderId: feedRow.folder_id || undefined,
          order: feedRow.order,
          unreadCount: feedRow.unread_count,
          refreshInterval: feedRow.refresh_interval,
          lastFetched: feedRow.last_fetched ? new Date(feedRow.last_fetched) : undefined,
        }
        store.updateFeed(feedRow.id, feed)
      },
      (id) => {
        // Fire-and-forget in realtime context
        store.removeFeed(id).catch((error) => {
          console.error("[WS] Realtime: Failed to remove feed", error)
        })
      },
    )

    // Subscribe to articles changes
    realtimeWSManager.subscribeToArticles(
      async (articleRow) => {
        const article: Article = {
          id: articleRow.id,
          feedId: articleRow.feed_id,
          title: articleRow.title,
          content: articleRow.content,
          summary: articleRow.summary || undefined,
          url: articleRow.url,
          author: articleRow.author || undefined,
          publishedAt: new Date(articleRow.published_at),
          isRead: articleRow.is_read,
          isStarred: articleRow.is_starred,
          thumbnail: articleRow.thumbnail || undefined,
          contentHash: articleRow.content_hash || undefined,
        }
        await store.addArticles([article])
      },
      async (articleRow) => {
        // For updates, we need to update the article in the store
        const existingArticle = store.articles.find((a) => a.id === articleRow.id)
        if (existingArticle) {
          const updatedArticle: Article = {
            ...existingArticle,
            isRead: articleRow.is_read,
            isStarred: articleRow.is_starred,
          }
          await store.addArticles([updatedArticle])
        }
      },
      (id) => {
        // Remove article from store
        useRSSStore.setState((state) => ({
          articles: state.articles.filter((a) => a.id !== id),
        }))
      },
    )

    // Subscribe to folders changes
    realtimeWSManager.subscribeToFolders(
      (folderRow) => {
        const folder: Folder = {
          id: folderRow.id,
          name: folderRow.name,
          createdAt: new Date(folderRow.created_at),
        }
        store.addFolder(folder)
      },
      (folderRow) => {
        store.renameFolder(folderRow.id, folderRow.name)
      },
      (id) => {
        store.removeFolder(id)
      },
    )

    // Cleanup on unmount
    return () => {
      console.log("[WS] Cleaning up real-time subscriptions")
      realtimeWSManager.unsubscribeAll()
    }
  }, []) // Empty dependency array - only run once on mount

  return null
}
