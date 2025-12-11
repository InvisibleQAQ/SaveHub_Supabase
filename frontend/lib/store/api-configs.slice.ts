import type { StateCreator } from "zustand"
import type { ApiConfig } from "../types"
import type { RSSReaderStore } from "./index"
import { logger } from "../logger"
import { apiConfigsApi } from "../api/api-configs"

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
    const createConfig = async () => {
      try {
        logger.debug({ configName: config.name }, 'Creating API config via backend')
        const newConfig = await apiConfigsApi.createApiConfig(config)

        set((state) => ({
          apiConfigs: [...state.apiConfigs, newConfig],
        }))

        logger.info({ configId: newConfig.id, configName: newConfig.name }, 'API config created')
      } catch (error) {
        logger.error({ error, configName: config.name }, 'Failed to create API config')
        set({ error: error instanceof Error ? error.message : "Unknown error" })
      }
    }
    createConfig()
  },

  updateApiConfig: (id, updates) => {
    const updateConfig = async () => {
      try {
        logger.debug({ configId: id }, 'Updating API config via backend')
        const updatedConfig = await apiConfigsApi.updateApiConfig(id, updates)

        set((state) => ({
          apiConfigs: state.apiConfigs.map((config) =>
            config.id === id ? updatedConfig : config
          ),
        }))

        logger.info({ configId: id }, 'API config updated')
      } catch (error) {
        logger.error({ error, configId: id }, 'Failed to update API config')
        set({ error: error instanceof Error ? error.message : "Unknown error" })
      }
    }
    updateConfig()
  },

  deleteApiConfig: (id) => {
    const deleteFromBackend = async () => {
      try {
        logger.debug({ configId: id }, 'Deleting API config via backend')
        await apiConfigsApi.deleteApiConfig(id)

        // Only update store if backend delete succeeded
        set((state) => ({
          apiConfigs: state.apiConfigs.filter((config) => config.id !== id),
        }))

        logger.info({ configId: id }, 'API config deleted')
      } catch (error) {
        logger.error({ error, configId: id }, 'Failed to delete API config')
        set({ error: error instanceof Error ? error.message : "Unknown error" })
      }
    }
    deleteFromBackend()
  },

  setDefaultApiConfig: (id) => {
    const setDefault = async () => {
      try {
        logger.debug({ configId: id }, 'Setting default API config via backend')
        await apiConfigsApi.setDefaultConfig(id)

        // Update store to reflect new default
        set((state) => ({
          apiConfigs: state.apiConfigs.map((config) => ({
            ...config,
            isDefault: config.id === id,
          })),
        }))

        logger.info({ configId: id }, 'Default API config set')
      } catch (error) {
        logger.error({ error, configId: id }, 'Failed to set default API config')
        set({ error: error instanceof Error ? error.message : "Unknown error" })
      }
    }
    setDefault()
  },

  syncApiConfigsToSupabase: async () => {
    // No-op: Each operation now calls the backend API directly.
    // This function is kept for interface compatibility.
    logger.debug('syncApiConfigsToSupabase called (no-op - using direct API calls)')
  },

  loadApiConfigsFromSupabase: async () => {
    try {
      set({ isLoading: true, error: null })
      logger.debug('Loading API configs from backend')
      const apiConfigs = await apiConfigsApi.getApiConfigs()
      set({ apiConfigs, isLoading: false })
      logger.debug({ loadedCount: apiConfigs.length }, 'API configs loaded from backend')
    } catch (error) {
      logger.error({ error }, 'Failed to load API configs from backend')
      set({
        error: error instanceof Error ? error.message : "Unknown error",
        isLoading: false,
      })
    }
  },
})
