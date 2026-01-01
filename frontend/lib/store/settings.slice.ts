import type { StateCreator } from "zustand"
import { settingsApi } from "../api/settings"
import type { RSSReaderState } from "../types"

type AppSettings = RSSReaderState["settings"]

export interface SettingsSlice {
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>
}

export const createSettingsSlice: StateCreator<
  any,
  [],
  [],
  SettingsSlice
> = (set, get) => ({
  updateSettings: async (updates) => {
    const state = get() as any
    const oldSettings = state.settings

    // Optimistic update
    const newSettings = { ...oldSettings, ...updates }
    set({ settings: newSettings } as any)

    try {
      // Call API with only the updated fields
      const result = await settingsApi.updateSettings(updates)
      // Update with server response to ensure consistency
      set({ settings: { ...oldSettings, ...result } } as any)
    } catch (error) {
      // Rollback on error
      set({ settings: oldSettings } as any)
      console.error("Failed to update settings:", error)
      throw error
    }
  },
})
