import type { StateCreator } from "zustand"
import type { Article } from "../types"

export interface UISlice {
  setSelectedFeed: (feedId: string | null) => void
  setSelectedArticle: (articleId: string | null) => void
  setSearchQuery: (query: string) => void
  setViewMode: (mode: "all" | "unread" | "starred") => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleChatSidebar: () => void
  setChatSidebarCollapsed: (collapsed: boolean) => void
  getFilteredArticles: (options?: { viewMode?: "all" | "unread" | "starred"; feedId?: string | null }) => Article[]
  getUnreadCount: (feedId?: string) => number
}

export const createUISlice: StateCreator<
  any,
  [],
  [],
  UISlice
> = (set, get) => ({
  setSelectedFeed: (feedId) => {
    set({ selectedFeedId: feedId, selectedArticleId: null } as any)
  },

  setSelectedArticle: (articleId) => {
    set({ selectedArticleId: articleId } as any)
    if (articleId) {
      ;(get() as any).markAsRead?.(articleId)
    }
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query } as any)
  },

  setViewMode: (mode) => {
    set({ viewMode: mode } as any)
  },

  setLoading: (loading) => {
    set({ isLoading: loading } as any)
  },

  setError: (error) => {
    set({ error } as any)
  },

  toggleSidebar: () => {
    set((state: any) => ({ isSidebarCollapsed: !state.isSidebarCollapsed }))
  },

  setSidebarCollapsed: (collapsed) => {
    set({ isSidebarCollapsed: collapsed } as any)
  },

  toggleChatSidebar: () => {
    set((state: any) => ({ isChatSidebarCollapsed: !state.isChatSidebarCollapsed }))
  },

  setChatSidebarCollapsed: (collapsed) => {
    set({ isChatSidebarCollapsed: collapsed } as any)
  },

  getFilteredArticles: (options) => {
    const state = get() as any
    let filtered = state.articles

    const viewMode = options?.viewMode !== undefined ? options.viewMode : state.viewMode
    const feedId = options?.feedId !== undefined ? options.feedId : state.selectedFeedId

    if (feedId) {
      filtered = filtered.filter((a: any) => a.feedId === feedId)
    }

    switch (viewMode) {
      case "unread":
        filtered = filtered.filter((a: any) => !a.isRead)
        break
      case "starred":
        filtered = filtered.filter((a: any) => a.isStarred)
        break
    }

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase()
      filtered = filtered.filter(
        (a: any) =>
          a.title.toLowerCase().includes(query) ||
          a.content.toLowerCase().includes(query) ||
          a.summary?.toLowerCase().includes(query) ||
          a.author?.toLowerCase().includes(query),
      )
    }

    return filtered.sort((a: any, b: any) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  },

  getUnreadCount: (feedId) => {
    const state = get() as any
    const articles = feedId ? state.articles.filter((a: any) => a.feedId === feedId) : state.articles
    return articles.filter((a: any) => !a.isRead).length
  },
})
