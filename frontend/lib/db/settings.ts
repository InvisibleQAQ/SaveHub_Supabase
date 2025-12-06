import { supabase } from "../supabase/client"
import { getCurrentUserId } from "./core"

export interface AppSettings {
  id: string
  theme: "light" | "dark" | "system"
  fontSize: number
  autoRefresh: boolean
  refreshInterval: number
  articlesRetentionDays: number
  markAsReadOnScroll: boolean
  showThumbnails: boolean
  sidebarPinned: boolean
}

export const defaultSettings: AppSettings = {
  id: "app-settings",
  theme: "system",
  fontSize: 16,
  autoRefresh: true,
  refreshInterval: 30,
  articlesRetentionDays: 30,
  markAsReadOnScroll: false,
  showThumbnails: true,
  sidebarPinned: false,
}

/**
 * Save user settings to database
 * Upserts settings for current user
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  const userId = await getCurrentUserId()

  const dbSettings = {
    user_id: userId,
    theme: settings.theme,
    font_size: settings.fontSize,
    auto_refresh: settings.autoRefresh,
    refresh_interval: settings.refreshInterval,
    articles_retention_days: settings.articlesRetentionDays,
    mark_as_read_on_scroll: settings.markAsReadOnScroll,
    show_thumbnails: settings.showThumbnails,
    sidebar_pinned: settings.sidebarPinned,
    updated_at: new Date().toISOString(),
  }

  console.log('[DB] Saving user settings')
  const { error } = await supabase.from("settings").upsert(dbSettings)

  if (error) {
    console.error('[DB] Failed to save settings:', error)
    throw error
  }

  console.log('[DB] Successfully saved settings')
}

/**
 * Load user settings from database
 * Returns null if no settings found for user
 */
export async function loadSettings(): Promise<AppSettings | null> {
  const userId = await getCurrentUserId()

  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", userId)
    .single()

  if (error) {
    if (error.code === "PGRST116") {
      // No settings found for user
      return null
    }
    console.error('[DB] Failed to load settings:', error)
    throw error
  }

  if (!data) return null

  return {
    id: data.user_id,
    theme: data.theme as "light" | "dark" | "system",
    fontSize: data.font_size,
    autoRefresh: data.auto_refresh,
    refreshInterval: data.refresh_interval,
    articlesRetentionDays: data.articles_retention_days,
    markAsReadOnScroll: data.mark_as_read_on_scroll,
    showThumbnails: data.show_thumbnails,
    sidebarPinned: data.sidebar_pinned ?? false,
  }
}