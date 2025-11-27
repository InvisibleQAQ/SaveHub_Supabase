import type { StateCreator } from "zustand"
import type { Feed } from "../types"
import { dbManager } from "../db"
// Client-side scheduler API (calls server-side BullMQ via API routes)
import { scheduleFeedRefresh, cancelFeedRefresh } from "../scheduler-client"

export interface FeedsSlice {
  addFeed: (feed: Partial<Feed>) => { success: boolean; reason: 'created' | 'duplicate' }
  removeFeed: (feedId: string) => Promise<{ success: boolean; error?: string; articlesDeleted?: number }>
  updateFeed: (feedId: string, updates: Partial<Feed>) => void
  moveFeed: (feedId: string, targetFolderId: string | undefined, targetOrder: number) => void
}

export const createFeedsSlice: StateCreator<
  any,
  [],
  [],
  FeedsSlice
> = (set, get) => ({
  addFeed: (feed) => {
    const state = get() as any

    const existingFeed = state.feeds.find((f: any) => f.url === feed.url)
    if (existingFeed) {
      return { success: false, reason: 'duplicate' as const }
    }

    const sameFolderFeeds = state.feeds.filter((f: any) => (f.folderId || undefined) === (feed.folderId || undefined))
    const maxOrder = sameFolderFeeds.reduce((max: number, f: any) => Math.max(max, f.order ?? -1), -1)

    // Use provided refreshInterval, or fallback to global settings, or default to 60
    const defaultRefreshInterval = state.settings?.refreshInterval ?? 60

    const newFeed: Feed = {
      ...feed,
      id: feed.id || crypto.randomUUID(),
      url: feed.url || "",
      title: feed.title || "",
      order: maxOrder + 1,
      unreadCount: 0,
      refreshInterval: feed.refreshInterval ?? defaultRefreshInterval,
    }

    set((state: any) => ({
      feeds: [...state.feeds, newFeed],
    }))

    ;(get() as any).syncToSupabase?.()

    // Schedule automatic refresh for new feed (async, fire-and-forget)
    scheduleFeedRefresh(newFeed).catch((err) => {
      console.error("Failed to schedule feed refresh:", err)
    })

    return { success: true, reason: 'created' as const }
  },

  removeFeed: async (feedId) => {
    // Pessimistic delete: delete from DB first, then update store
    // This ensures store and DB stay consistent
    try {
      const state = get() as any
      const feed = state.feeds.find((f: any) => f.id === feedId)

      if (!feed) {
        console.warn(`Feed ${feedId} not found in store`)
        return { success: false, error: 'Feed not found in store' }
      }

      // Step 1: Delete from database (this will also delete associated articles)
      const { deleteFeed } = await import("../db")
      const stats = await deleteFeed(feedId)

      // Step 2: Cancel scheduler (prevents memory leak)
      await cancelFeedRefresh(feedId)

      // Step 3: Update store only if DB delete succeeded
      set((state: any) => ({
        feeds: state.feeds.filter((f: any) => f.id !== feedId),
        articles: state.articles.filter((a: any) => a.feedId !== feedId),
        selectedFeedId: state.selectedFeedId === feedId ? null : state.selectedFeedId,
      }))

      console.info(`Feed "${feed.title}" deleted successfully. Removed ${stats.articlesDeleted} articles.`)
      return { success: true, articlesDeleted: stats.articlesDeleted }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`Failed to delete feed from database:`, error)
      // Store remains unchanged if DB delete fails
      return { success: false, error: errorMessage }
    }
  },

  updateFeed: (feedId, updates) => {
    set((state: any) => ({
      feeds: state.feeds.map((f: any) => (f.id === feedId ? { ...f, ...updates } : f)),
    }))

    ;(get() as any).syncToSupabase?.()

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
      const updatedFeed = get().feeds.find((f: any) => f.id === feedId)
      if (updatedFeed) {
        // This will cancel old schedule and create new one with updated data (async, fire-and-forget)
        scheduleFeedRefresh(updatedFeed).catch((err) => {
          console.error("Failed to reschedule feed refresh:", err)
        })
      }
    }
  },

  moveFeed: (feedId, targetFolderId, targetOrder) => {
    set((state: any) => {
      const feed = state.feeds.find((f: any) => f.id === feedId)
      if (!feed) return state

      const oldFolderId = feed.folderId

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

      return { feeds: updatedFeeds }
    })

    ;(get() as any).syncToSupabase?.()
  },
})
