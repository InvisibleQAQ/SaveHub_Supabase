"use client"

import { useEffect } from "react"
import { realtimeWSManager } from "@/lib/realtime-ws"
import { useRSSStore } from "@/lib/store"
import type { Feed, Article, Folder } from "@/lib/types"

function mapFeedRowToFeed(feedRow: Record<string, any>): Feed {
  return {
    id: feedRow.id,
    title: feedRow.title,
    url: feedRow.url,
    description: feedRow.description || undefined,
    category: feedRow.category || undefined,
    folderId: feedRow.folder_id || undefined,
    order: feedRow.order ?? 0,
    unreadCount: feedRow.unread_count ?? 0,
    refreshInterval: feedRow.refresh_interval ?? 60,
    lastFetched: feedRow.last_fetched ? new Date(feedRow.last_fetched) : undefined,
    lastFetchStatus: feedRow.last_fetch_status || undefined,
    lastFetchError: feedRow.last_fetch_error || undefined,
    enableDeduplication: feedRow.enable_deduplication ?? false,
  }
}

function mapArticleRowToArticle(articleRow: Record<string, any>): Article {
  return {
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
    repositoryCount: articleRow.repository_count ?? 0,
  }
}

function mapFolderRowToFolder(folderRow: Record<string, any>): Folder {
  return {
    id: folderRow.id,
    name: folderRow.name,
    order: folderRow.order ?? 0,
    createdAt: new Date(folderRow.created_at),
  }
}

export function useRealtimeSync() {
  useEffect(() => {
    console.log("[WS] Setting up real-time subscriptions")

    // Subscribe to feeds changes
    realtimeWSManager.subscribeToFeeds(
      (feedRow) => {
        const feed = mapFeedRowToFeed(feedRow)
        useRSSStore.setState((state) => {
          const existingIndex = state.feeds.findIndex((f) => f.id === feed.id)
          if (existingIndex === -1) {
            return { feeds: [...state.feeds, feed] }
          }

          const nextFeeds = [...state.feeds]
          nextFeeds[existingIndex] = {
            ...nextFeeds[existingIndex],
            ...feed,
          }
          return { feeds: nextFeeds }
        })
      },
      (feedRow) => {
        const feed = mapFeedRowToFeed(feedRow)
        useRSSStore.setState((state) => {
          const existingIndex = state.feeds.findIndex((f) => f.id === feed.id)
          if (existingIndex === -1) {
            return { feeds: [...state.feeds, feed] }
          }

          const nextFeeds = [...state.feeds]
          nextFeeds[existingIndex] = {
            ...nextFeeds[existingIndex],
            ...feed,
          }
          return { feeds: nextFeeds }
        })
      },
      (id) => {
        useRSSStore.setState((state) => ({
          feeds: state.feeds.filter((f) => f.id !== id),
          articles: state.articles.filter((a) => a.feedId !== id),
          selectedFeedId: state.selectedFeedId === id ? null : state.selectedFeedId,
        }))
      },
    )

    // Subscribe to articles changes
    realtimeWSManager.subscribeToArticles(
      (articleRow) => {
        const article = mapArticleRowToArticle(articleRow)
        useRSSStore.setState((state) => {
          const existingIndex = state.articles.findIndex((a) => a.id === article.id)
          if (existingIndex === -1) {
            return { articles: [...state.articles, article] }
          }

          const nextArticles = [...state.articles]
          nextArticles[existingIndex] = {
            ...nextArticles[existingIndex],
            ...article,
          }
          return { articles: nextArticles }
        })
      },
      (articleRow) => {
        const article = mapArticleRowToArticle(articleRow)
        useRSSStore.setState((state) => {
          const existingIndex = state.articles.findIndex((a) => a.id === article.id)
          if (existingIndex === -1) {
            return { articles: [...state.articles, article] }
          }

          const nextArticles = [...state.articles]
          nextArticles[existingIndex] = {
            ...nextArticles[existingIndex],
            ...article,
          }
          return { articles: nextArticles }
        })
      },
      (id) => {
        useRSSStore.setState((state) => ({
          articles: state.articles.filter((a) => a.id !== id),
        }))
      },
    )

    // Subscribe to folders changes
    realtimeWSManager.subscribeToFolders(
      (folderRow) => {
        const folder = mapFolderRowToFolder(folderRow)
        useRSSStore.setState((state) => {
          const existingIndex = state.folders.findIndex((f) => f.id === folder.id)
          if (existingIndex === -1) {
            return { folders: [...state.folders, folder] }
          }

          const nextFolders = [...state.folders]
          nextFolders[existingIndex] = {
            ...nextFolders[existingIndex],
            ...folder,
          }
          return { folders: nextFolders }
        })
      },
      (folderRow) => {
        const folder = mapFolderRowToFolder(folderRow)
        useRSSStore.setState((state) => {
          const existingIndex = state.folders.findIndex((f) => f.id === folder.id)
          if (existingIndex === -1) {
            return { folders: [...state.folders, folder] }
          }

          const nextFolders = [...state.folders]
          nextFolders[existingIndex] = {
            ...nextFolders[existingIndex],
            ...folder,
          }
          return { folders: nextFolders }
        })
      },
      (id) => {
        useRSSStore.setState((state) => ({
          folders: state.folders.filter((f) => f.id !== id),
          feeds: state.feeds.map((feed) =>
            feed.folderId === id ? { ...feed, folderId: undefined } : feed
          ),
        }))
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
