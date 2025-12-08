import type { StateCreator } from "zustand"
import { settingsApi } from "../api/settings"
import type { RSSReaderState } from "../types"

type AppSettings = RSSReaderState["settings"]

export interface SettingsSlice {
  updateSettings: (updates: Partial<AppSettings>) => void
}

export const createSettingsSlice: StateCreator<
  any,
  [],
  [],
  SettingsSlice
> = (set, get) => ({
  updateSettings: (updates) => {
    const state = get() as any
    const newSettings = { ...state.settings, ...updates }
    set({ settings: newSettings } as any)

    settingsApi.updateSettings(newSettings).catch(console.error)
  },
})
