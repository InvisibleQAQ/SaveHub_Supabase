import type { StateCreator } from "zustand"
import type { ApiConfig } from "../types"
import type { RSSReaderStore } from "./index"

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
    set((state) => ({
      apiConfigs: state.apiConfigs.filter((config) => config.id !== id),
    }))

    // Auto-sync to database
    get().syncApiConfigsToSupabase()
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
      // This will be implemented in the database operations
      const { saveApiConfigs } = await import("../db")
      await saveApiConfigs(apiConfigs)
    } catch (error) {
      console.error("Failed to sync API configs to Supabase:", error)
      set({ error: error instanceof Error ? error.message : "Unknown error" })
    }
  },

  loadApiConfigsFromSupabase: async () => {
    try {
      set({ isLoading: true, error: null })
      const { loadApiConfigs } = await import("../db")
      const apiConfigs = await loadApiConfigs()
      set({ apiConfigs, isLoading: false })
    } catch (error) {
      console.error("Failed to load API configs from Supabase:", error)
      set({
        error: error instanceof Error ? error.message : "Unknown error",
        isLoading: false,
      })
    }
  },
})