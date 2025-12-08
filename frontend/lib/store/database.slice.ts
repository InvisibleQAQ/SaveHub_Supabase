import type { StateCreator } from "zustand"
import { authApi } from "../api/auth"
import { foldersApi } from "../api/folders"
import { feedsApi } from "../api/feeds"
import { articlesApi } from "../api/articles"
import { settingsApi } from "../api/settings"

// Default settings for new users
const defaultSettings = {
  theme: "system" as const,
  fontSize: 16,
  autoRefresh: true,
  refreshInterval: 30,
  articlesRetentionDays: 30,
  markAsReadOnScroll: false,
  showThumbnails: true,
  sidebarPinned: false,
}

export interface DatabaseSlice {
  isDatabaseReady: boolean
  setDatabaseReady: (ready: boolean) => void
  checkDatabaseStatus: () => Promise<boolean>
  syncToSupabase: () => Promise<void>
  loadFromSupabase: () => Promise<void>
}

export const createDatabaseSlice: StateCreator<
  any,
  [],
  [],
  DatabaseSlice
> = (set, get) => ({
  isDatabaseReady: false,

  checkDatabaseStatus: async () => {
    try {
      // Check if user is authenticated via FastAPI backend
      const session = await authApi.getSession()
      const isReady = session.authenticated
      set({ isDatabaseReady: isReady } as any)
      return isReady
    } catch (error) {
      console.error("Error checking database status:", error)
      set({ isDatabaseReady: false } as any)
      return false
    }
  },

  setDatabaseReady: (ready) => {
    set({ isDatabaseReady: ready } as any)
  },

  syncToSupabase: async () => {
    // Note: Individual slices now sync data on each operation
    // This method is kept for backward compatibility but does nothing
    // because data is already synced via API calls in each slice action
    const state = get() as any
    if (!state.isDatabaseReady) {
      return
    }
    // No-op: Data is synced in real-time by individual slice actions
  },

  loadFromSupabase: async () => {
    const isReady = await (get() as any).checkDatabaseStatus()

    if (!isReady) {
      set({
        isLoading: false,
        error: null,
      } as any)
      return
    }

    try {
      set({ isLoading: true } as any)

      // Load all data from FastAPI backend in parallel
      const [folders, feeds, articles, settings] = await Promise.all([
        foldersApi.getFolders(),
        feedsApi.getFeeds(),
        articlesApi.getArticles(),
        settingsApi.getSettings().catch(() => null),
      ])

      console.log('[Store] Loaded data via API')

      set({
        folders: folders || [],
        feeds: feeds || [],
        articles: articles || [],
        settings: settings || defaultSettings,
        apiConfigs: [], // API configs not yet migrated to FastAPI
        isLoading: false,
      } as any)

      // Clear old articles based on retention settings
      const retentionDays = settings?.articlesRetentionDays || 30
      const result = await articlesApi.clearOldArticles(retentionDays)

      if (result.deletedCount > 0) {
        // Reload articles after cleanup
        const updatedArticles = await articlesApi.getArticles()
        set({ articles: updatedArticles || [] } as any)
      }
    } catch (error) {
      console.error("Failed to load from API:", error)
      set({
        error: "Failed to load saved data",
        isLoading: false,
      } as any)
    }
  },
})
