import type { StateCreator } from "zustand"
import { dbManager, defaultSettings } from "../db"

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
      const isReady = await dbManager.isDatabaseInitialized()
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
    const state = get() as any
    if (!state.isDatabaseReady) {
      return
    }

    try {
      await Promise.all([
        dbManager.saveFolders(state.folders),
        dbManager.saveFeeds(state.feeds),
        dbManager.saveArticles(state.articles),
        dbManager.saveSettings(state.settings),
        dbManager.saveApiConfigs(state.apiConfigs),
      ])
    } catch (error) {
      console.error("Failed to sync to Supabase:", error)
    }
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

      const [folders, feeds, articles, settings, apiConfigs] = await Promise.all([
        dbManager.loadFolders(),
        dbManager.loadFeeds(),
        dbManager.loadArticles(),
        dbManager.loadSettings(),
        dbManager.loadApiConfigs(),
      ])

      set({
        folders: folders || [],
        feeds: feeds || [],
        articles: articles || [],
        settings: settings || defaultSettings,
        apiConfigs: apiConfigs || [],
        isLoading: false,
      } as any)

      const retentionDays = settings?.articlesRetentionDays || 30
      const deletedCount = await dbManager.clearOldArticles(retentionDays)

      if (deletedCount > 0) {
        const updatedArticles = await dbManager.loadArticles()
        set({ articles: updatedArticles || [] } as any)
      }
    } catch (error) {
      console.error("Failed to load from Supabase:", error)
      set({
        error: "Failed to load saved data",
        isLoading: false,
      } as any)
    }
  },
})
