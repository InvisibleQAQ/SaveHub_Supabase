import type { StateCreator } from "zustand"
import type { Feed } from "../types"
import { dbManager } from "../db"

export interface FeedsSlice {
  addFeed: (feed: Partial<Feed>) => void
  removeFeed: (feedId: string) => void
  updateFeed: (feedId: string, updates: Partial<Feed>) => void
  moveFeed: (feedId: string, targetFolderId: string | undefined, targetOrder: number) => void
}

export const createFeedsSlice: StateCreator<
  FeedsSlice,
  [],
  [],
  FeedsSlice
> = (set, get) => ({
  addFeed: (feed) => {
    const state = get() as any
    const sameFolderFeeds = state.feeds.filter((f: any) => (f.folderId || undefined) === (feed.folderId || undefined))
    const maxOrder = sameFolderFeeds.reduce((max: number, f: any) => Math.max(max, f.order ?? -1), -1)

    const newFeed: Feed = {
      ...feed,
      id: feed.id || crypto.randomUUID(),
      url: feed.url || "",
      title: feed.title || "",
      order: maxOrder + 1,
      unreadCount: 0,
    }

    set((state: any) => {
      const existingFeed = state.feeds.find((f: any) => f.id === newFeed.id || f.url === newFeed.url)
      if (existingFeed) {
        return {
          feeds: state.feeds.map((f: any) => (f.id === existingFeed.id ? { ...f, ...newFeed } : f)),
        }
      }

      return {
        feeds: [...state.feeds, newFeed],
      }
    })

    ;(get() as any).syncToSupabase?.()
  },

  removeFeed: (feedId) => {
    set((state: any) => ({
      feeds: state.feeds.filter((f: any) => f.id !== feedId),
      articles: state.articles.filter((a: any) => a.feedId !== feedId),
      selectedFeedId: state.selectedFeedId === feedId ? null : state.selectedFeedId,
    }))

    dbManager.deleteFeed(feedId).catch(console.error)
  },

  updateFeed: (feedId, updates) => {
    set((state: any) => ({
      feeds: state.feeds.map((f: any) => (f.id === feedId ? { ...f, ...updates } : f)),
    }))

    ;(get() as any).syncToSupabase?.()
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
