import type { StateCreator } from "zustand"
import type { ApiConfig } from "../types"
import type { RSSReaderStore } from "./index"
import { logger } from "../logger"

export interface ApiConfigsSlice {
  // Actions
  addApiConfig: (config: Omit<ApiConfig, "id" | "createdAt">) => void
  updateApiConfig: (id: string, updates: Partial<ApiConfig>) => void
  deleteApiConfig: (id: string) => void
  setDefaultApiConfig: (id: string) => void
  syncApiConfigsToSupabase: () => Promise<void>
  loadApiConfigsFromSupabase: () => Promise<void>
}

export const createApiConfigsSlice: StateCreator<
  RSSReaderStore,
  [],
  [],
  ApiConfigsSlice
> = (set, get) => ({
  addApiConfig: (config) => {
    const newConfig: ApiConfig = {
      ...config,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    }

    set((state) => ({
      apiConfigs: [...state.apiConfigs, newConfig],
    }))

    // Auto-sync to database
    get().syncApiConfigsToSupabase()
  },

  updateApiConfig: (id, updates) => {
    set((state) => ({
      apiConfigs: state.apiConfigs.map((config) =>
        config.id === id ? { ...config, ...updates } : config
      ),
    }))

    // Auto-sync to database
    get().syncApiConfigsToSupabase()
  },

  deleteApiConfig: (id) => {
    // Pessimistic delete: delete from DB first, then update store
    // This ensures store and DB stay consistent
    const deleteFromDB = async () => {
      try {
        logger.debug({ configId: id }, 'Deleting API config from store')
        const { deleteApiConfig: dbDeleteApiConfig } = await import("../db")
        await dbDeleteApiConfig(id)

        // Only update store if DB delete succeeded
        set((state) => ({
          apiConfigs: state.apiConfigs.filter((config) => config.id !== id),
        }))

        logger.info({ configId: id }, 'API config deleted from store')
      } catch (error) {
        logger.error({ error, configId: id }, 'Failed to delete API config from database')
        set({ error: error instanceof Error ? error.message : "Unknown error" })
      }
    }
    deleteFromDB()
  },

  setDefaultApiConfig: (id) => {
    set((state) => ({
      apiConfigs: state.apiConfigs.map((config) => ({
        ...config,
        isDefault: config.id === id,
      })),
    }))

    // Auto-sync to database
    get().syncApiConfigsToSupabase()
  },

  syncApiConfigsToSupabase: async () => {
    try {
      const { apiConfigs } = get()
      logger.debug({ configCount: apiConfigs.length }, 'Syncing API configs to Supabase')
      const { saveApiConfigs } = await import("../db")
      await saveApiConfigs(apiConfigs)
      logger.debug({ configCount: apiConfigs.length }, 'API configs synced to Supabase')
    } catch (error) {
      logger.error({ error }, 'Failed to sync API configs to Supabase')
      set({ error: error instanceof Error ? error.message : "Unknown error" })
    }
  },

  loadApiConfigsFromSupabase: async () => {
    try {
      set({ isLoading: true, error: null })
      logger.debug('Loading API configs from Supabase')
      const { loadApiConfigs } = await import("../db")
      const apiConfigs = await loadApiConfigs()
      set({ apiConfigs, isLoading: false })
      logger.debug({ loadedCount: apiConfigs.length }, 'API configs loaded from Supabase')
    } catch (error) {
      logger.error({ error }, 'Failed to load API configs from Supabase')
      set({
        error: error instanceof Error ? error.message : "Unknown error",
        isLoading: false,
      })
    }
  },
})