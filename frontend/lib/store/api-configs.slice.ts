import type { StateCreator } from "zustand"
import type { ApiConfig, ApiConfigType, ApiConfigsGrouped } from "../types"
import type { RSSReaderStore } from "./index"
import { logger } from "../logger"
import { apiConfigsApi } from "../api/api-configs"

export interface ApiConfigsSlice {
  // Actions
  addApiConfig: (config: Omit<ApiConfig, "id" | "createdAt" | "updatedAt">) => Promise<void>
  updateApiConfig: (id: string, updates: Partial<ApiConfig>) => Promise<void>
  deleteApiConfig: (id: string) => Promise<void>
  activateApiConfig: (id: string) => Promise<void>
  loadApiConfigsFromSupabase: () => Promise<void>

  // Selectors
  getActiveConfig: (type: ApiConfigType) => ApiConfig | undefined
}

/**
 * Find which type a config belongs to.
 */
function findConfigType(grouped: ApiConfigsGrouped, configId: string): ApiConfigType | null {
  for (const type of ["chat", "embedding", "rerank"] as ApiConfigType[]) {
    if (grouped[type].some((c) => c.id === configId)) {
      return type
    }
  }
  return null
}

export const createApiConfigsSlice: StateCreator<
  RSSReaderStore,
  [],
  [],
  ApiConfigsSlice
> = (set, get) => ({
  addApiConfig: async (config) => {
    try {
      logger.debug({ configName: config.name, type: config.type }, "Creating API config")
      const newConfig = await apiConfigsApi.create(config)

      set((state) => {
        const grouped = { ...state.apiConfigsGrouped }
        const type = newConfig.type

        // If new config is active, deactivate others of same type in local state
        if (newConfig.isActive) {
          grouped[type] = grouped[type].map((c) => ({ ...c, isActive: false }))
        }
        grouped[type] = [...grouped[type], newConfig]

        return { apiConfigsGrouped: grouped }
      })

      logger.info({ configId: newConfig.id, type: newConfig.type }, "API config created")
    } catch (error) {
      logger.error({ error, configName: config.name }, "Failed to create API config")
      set({ error: error instanceof Error ? error.message : "Unknown error" })
      throw error
    }
  },

  updateApiConfig: async (id, updates) => {
    try {
      logger.debug({ configId: id }, "Updating API config")
      const updatedConfig = await apiConfigsApi.update(id, updates)

      set((state) => {
        const grouped = { ...state.apiConfigsGrouped }
        const type = updatedConfig.type

        // If activating, deactivate others of same type
        if (updatedConfig.isActive) {
          grouped[type] = grouped[type].map((c) =>
            c.id === id ? updatedConfig : { ...c, isActive: false }
          )
        } else {
          grouped[type] = grouped[type].map((c) =>
            c.id === id ? updatedConfig : c
          )
        }

        return { apiConfigsGrouped: grouped }
      })

      logger.info({ configId: id }, "API config updated")
    } catch (error) {
      logger.error({ error, configId: id }, "Failed to update API config")
      set({ error: error instanceof Error ? error.message : "Unknown error" })
      throw error
    }
  },

  deleteApiConfig: async (id) => {
    try {
      logger.debug({ configId: id }, "Deleting API config")
      await apiConfigsApi.delete(id)

      set((state) => {
        const grouped = { ...state.apiConfigsGrouped }

        // Remove from whichever type it belongs to
        for (const type of ["chat", "embedding", "rerank"] as ApiConfigType[]) {
          grouped[type] = grouped[type].filter((c) => c.id !== id)
        }

        return { apiConfigsGrouped: grouped }
      })

      logger.info({ configId: id }, "API config deleted")
    } catch (error) {
      logger.error({ error, configId: id }, "Failed to delete API config")
      set({ error: error instanceof Error ? error.message : "Unknown error" })
      throw error
    }
  },

  activateApiConfig: async (id) => {
    try {
      logger.debug({ configId: id }, "Activating API config")
      await apiConfigsApi.activate(id)

      set((state) => {
        const grouped = { ...state.apiConfigsGrouped }
        const type = findConfigType(grouped, id)

        if (type) {
          // Deactivate all, activate target
          grouped[type] = grouped[type].map((c) => ({
            ...c,
            isActive: c.id === id,
          }))
        }

        return { apiConfigsGrouped: grouped }
      })

      logger.info({ configId: id }, "API config activated")
    } catch (error) {
      logger.error({ error, configId: id }, "Failed to activate API config")
      set({ error: error instanceof Error ? error.message : "Unknown error" })
      throw error
    }
  },

  loadApiConfigsFromSupabase: async () => {
    try {
      // Note: Don't set global isLoading here - it causes infinite loop
      // because reader layout unmounts children when isLoading is true
      logger.debug("Loading API configs from backend")

      const grouped = await apiConfigsApi.getGrouped()
      set({ apiConfigsGrouped: grouped })

      const totalCount = grouped.chat.length + grouped.embedding.length + grouped.rerank.length
      logger.debug(
        { chat: grouped.chat.length, embedding: grouped.embedding.length, rerank: grouped.rerank.length },
        `Loaded ${totalCount} API configs`
      )
    } catch (error) {
      logger.error({ error }, "Failed to load API configs")
      // Don't set global error - API config loading failure shouldn't block the whole app
      // Settings page will handle empty state gracefully
      set({
        apiConfigsGrouped: { chat: [], embedding: [], rerank: [] },
      })
    }
  },

  getActiveConfig: (type) => {
    const grouped = get().apiConfigsGrouped
    return grouped[type].find((c) => c.isActive)
  },
})
