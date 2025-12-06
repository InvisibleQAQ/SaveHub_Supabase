import type { StateCreator } from "zustand"
import { dbManager, type AppSettings } from "../db"

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

    dbManager.saveSettings(newSettings).catch(console.error)
  },
})
