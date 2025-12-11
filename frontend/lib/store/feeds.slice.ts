import type { StateCreator } from "zustand"
import type { Feed } from "../types"
import { feedsApi } from "../api/feeds"
// Client-side queue API (calls FastAPI Celery backend)
import { scheduleFeedRefresh, cancelFeedRefresh } from "../queue-client"

export interface FeedsSlice {
  addFeed: (feed: Partial<Feed>) => Promise<{ success: boolean; reason: 'created' | 'duplicate' | 'error'; error?: string }>
  removeFeed: (feedId: string) => Promise<{ success: boolean; error?: string; articlesDeleted?: number }>
  updateFeed: (feedId: string, updates: Partial<Feed>) => Promise<{ success: boolean; error?: string }>
  moveFeed: (feedId: string, targetFolderId: string | undefined, targetOrder: number) => Promise<void>
}

export const createFeedsSlice: StateCreator<
  any,
  [],
  [],
  FeedsSlice
> = (set, get) => ({
  addFeed: async (feed) => {
    const state = get() as any

    // Check for duplicate in local state first (fast path)
    const existingFeed = state.feeds.find((f: any) => f.url === feed.url)
    if (existingFeed) {
      return { success: false, reason: 'duplicate' as const }
    }

    // Helper functions for strict type checking to prevent circular reference from DOM elements
    const isString = (val: unknown): val is string => typeof val === "string"
    const isNumber = (val: unknown): val is number => typeof val === "number" && !Number.isNaN(val)
    const isBoolean = (val: unknown): val is boolean => typeof val === "boolean"
    const isDate = (val: unknown): val is Date => val instanceof Date && !Number.isNaN(val.getTime())

    const sameFolderFeeds = state.feeds.filter((f: any) => (f.folderId || undefined) === (feed.folderId || undefined))
    const maxOrder = sameFolderFeeds.reduce((max: number, f: any) => Math.max(max, f.order ?? -1), -1)

    // Use provided refreshInterval, or fallback to global settings, or default to 60
    const defaultRefreshInterval = state.settings?.refreshInterval ?? 60

    // Explicitly copy only known fields with strict type validation
    // This prevents circular reference issues from DOM elements or React fiber references
    const newFeed: Feed = {
      id: isString(feed.id) ? feed.id : crypto.randomUUID(),
      url: isString(feed.url) ? feed.url : "",
      title: isString(feed.title) ? feed.title : "",
      description: isString(feed.description) ? feed.description : undefined,
      category: isString(feed.category) ? feed.category : undefined,
      folderId: isString(feed.folderId) ? feed.folderId : undefined,
      order: maxOrder + 1,
      unreadCount: isNumber(feed.unreadCount) ? feed.unreadCount : 0,
      lastFetched: isDate(feed.lastFetched) ? feed.lastFetched : undefined,
      refreshInterval: isNumber(feed.refreshInterval) ? feed.refreshInterval : defaultRefreshInterval,
      lastFetchStatus: feed.lastFetchStatus === "success" || feed.lastFetchStatus === "failed" ? feed.lastFetchStatus : undefined,
      lastFetchError: isString(feed.lastFetchError) ? feed.lastFetchError : undefined,
      enableDeduplication: isBoolean(feed.enableDeduplication) ? feed.enableDeduplication : false,
    }

    try {
      // Pessimistic update: save to API first
      await feedsApi.saveFeeds([newFeed])

      // API succeeded, update local store
      set((state: any) => ({
        feeds: [...state.feeds, newFeed],
      }))

      // Schedule automatic refresh for new feed (async, fire-and-forget)
      scheduleFeedRefresh(newFeed.id).catch((err) => {
        console.error("Failed to schedule feed refresh:", err)
      })

      return { success: true, reason: 'created' as const }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      if (errorMessage === 'duplicate') {
        return { success: false, reason: 'duplicate' as const }
      }
      console.error("Failed to add feed:", error)
      return { success: false, reason: 'error' as const, error: errorMessage }
    }
  },

  removeFeed: async (feedId) => {
    try {
      const state = get() as any
      const feed = state.feeds.find((f: any) => f.id === feedId)

      if (!feed) {
        console.warn(`Feed ${feedId} not found in store`)
        return { success: false, error: 'Feed not found in store' }
      }

      // Step 1: Delete from API (this will also delete associated articles)
      const stats = await feedsApi.deleteFeed(feedId)

      // Step 2: Cancel scheduler (prevents memory leak)
      await cancelFeedRefresh(feedId)

      // Step 3: Update store only if API delete succeeded
      set((state: any) => ({
        feeds: state.feeds.filter((f: any) => f.id !== feedId),
        articles: state.articles.filter((a: any) => a.feedId !== feedId),
        selectedFeedId: state.selectedFeedId === feedId ? null : state.selectedFeedId,
      }))

      console.info(`Feed "${feed.title}" deleted successfully. Removed ${stats.articlesDeleted} articles.`)
      return { success: true, articlesDeleted: stats.articlesDeleted }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`Failed to delete feed from API:`, error)
      return { success: false, error: errorMessage }
    }
  },

  updateFeed: async (feedId, updates) => {
    try {
      // Call API first (pessimistic update)
      await feedsApi.updateFeed(feedId, updates)

      // API succeeded, update local store
      set((state: any) => ({
        feeds: state.feeds.map((f: any) => (f.id === feedId ? { ...f, ...updates } : f)),
      }))

      // Reschedule if any scheduling-relevant field changed:
      // - url: Task payload contains feedUrl
      // - title: Task payload contains feedTitle
      // - refreshInterval: Affects delay calculation
      // - lastFetched: Affects delay calculation
      const needsReschedule =
        updates.url !== undefined ||
        updates.title !== undefined ||
        updates.refreshInterval !== undefined ||
        updates.lastFetched !== undefined

      if (needsReschedule) {
        // Reschedule with feedId - Celery backend fetches latest data from database
        scheduleFeedRefresh(feedId).catch((err) => {
          console.error("Failed to reschedule feed refresh:", err)
        })
      }

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error("Failed to update feed:", error)
      return { success: false, error: errorMessage }
    }
  },

  moveFeed: async (feedId, targetFolderId, targetOrder) => {
    const state = get() as any
    const feed = state.feeds.find((f: any) => f.id === feedId)
    if (!feed) return

    const oldFolderId = feed.folderId

    // Calculate new feed positions locally
    let updatedFeeds = state.feeds.map((f: any) =>
      f.id === feedId ? { ...f, folderId: targetFolderId } : f
    )

    const sameFolderFeeds = updatedFeeds.filter(
      (f: any) => (f.folderId || undefined) === (targetFolderId || undefined)
    )

    const otherFeeds = updatedFeeds.filter(
      (f: any) => (f.folderId || undefined) !== (targetFolderId || undefined)
    )

    const movedFeed = sameFolderFeeds.find((f: any) => f.id === feedId)!
    const otherSameFolderFeeds = sameFolderFeeds.filter((f: any) => f.id !== feedId)

    otherSameFolderFeeds.splice(targetOrder, 0, movedFeed)

    const reorderedSameFolderFeeds = otherSameFolderFeeds.map((f: any, index: number) => ({
      ...f,
      order: index,
    }))

    if (oldFolderId !== targetFolderId && oldFolderId !== undefined) {
      const oldFolderFeeds = otherFeeds
        .filter((f: any) => f.folderId === oldFolderId)
        .map((f: any, index: number) => ({ ...f, order: index }))

      updatedFeeds = [...reorderedSameFolderFeeds, ...oldFolderFeeds, ...otherFeeds.filter((f: any) => f.folderId !== oldFolderId)]
    } else {
      updatedFeeds = [...reorderedSameFolderFeeds, ...otherFeeds]
    }

    try {
      // Save all feeds to API (to persist order changes)
      await feedsApi.saveFeeds(updatedFeeds)

      // Update local store
      set({ feeds: updatedFeeds })
    } catch (error) {
      console.error("Failed to save feed order:", error)
      // On error, don't update local store to keep it consistent with API
    }
  },
})
