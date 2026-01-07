/**
 * Settings API client for FastAPI backend.
 * Uses HttpOnly cookies for authentication.
 */

import type { RSSReaderState } from "../types"
import { fetchWithAuth } from "./fetch-client"

type Settings = RSSReaderState["settings"]

const API_BASE = "/api/backend/settings"

export interface ApiError {
  detail: string
}

export interface SettingsResponse extends Settings {
  userId?: string
  updatedAt?: Date
}

/**
 * Transform backend snake_case settings to frontend camelCase.
 */
function transformSettings(raw: Record<string, unknown>): SettingsResponse {
  return {
    theme: (raw.theme as string) ?? "system",
    fontSize: (raw.font_size as number) ?? 16,
    autoRefresh: (raw.auto_refresh as boolean) ?? true,
    refreshInterval: (raw.refresh_interval as number) ?? 30,
    articlesRetentionDays: (raw.articles_retention_days as number) ?? 30,
    markAsReadOnScroll: (raw.mark_as_read_on_scroll as boolean) ?? false,
    showThumbnails: (raw.show_thumbnails as boolean) ?? true,
    sidebarPinned: (raw.sidebar_pinned as boolean) ?? false,
    githubToken: raw.github_token as string | undefined,
    userId: raw.user_id as string | undefined,
    updatedAt: raw.updated_at ? new Date(raw.updated_at as string) : undefined,
  }
}

/**
 * Transform frontend camelCase settings to backend snake_case.
 */
function toApiFormat(settings: Partial<Settings>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (settings.theme !== undefined) result.theme = settings.theme
  if (settings.fontSize !== undefined) result.font_size = settings.fontSize
  if (settings.autoRefresh !== undefined) result.auto_refresh = settings.autoRefresh
  if (settings.refreshInterval !== undefined) result.refresh_interval = settings.refreshInterval
  if (settings.articlesRetentionDays !== undefined) result.articles_retention_days = settings.articlesRetentionDays
  if (settings.markAsReadOnScroll !== undefined) result.mark_as_read_on_scroll = settings.markAsReadOnScroll
  if (settings.showThumbnails !== undefined) result.show_thumbnails = settings.showThumbnails
  if (settings.sidebarPinned !== undefined) result.sidebar_pinned = settings.sidebarPinned
  // Support explicit null to delete token
  if ('githubToken' in settings) result.github_token = settings.githubToken ?? null

  return result
}

/**
 * Get user settings.
 * Returns default settings if none exist.
 */
export async function getSettings(): Promise<SettingsResponse> {
  const response = await fetchWithAuth(API_BASE, {
    method: "GET",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get settings")
  }

  const data = await response.json()
  return transformSettings(data)
}

/**
 * Update user settings.
 * Creates settings if they don't exist (upsert).
 * Supports partial updates - only provided fields will be updated.
 */
export async function updateSettings(settings: Partial<Settings>): Promise<SettingsResponse> {
  const apiData = toApiFormat(settings)
  console.log('[Settings API] Sending update:', apiData)

  const response = await fetchWithAuth(API_BASE, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(apiData),
  })

  if (!response.ok) {
    console.error('[Settings API] Update failed:', response.status, response.statusText)
    try {
      const error: ApiError = await response.json()
      console.error('[Settings API] Error details:', error)
      throw new Error(error.detail || "Failed to update settings")
    } catch (e) {
      throw new Error(`Failed to update settings: ${response.status} ${response.statusText}`)
    }
  }

  const data = await response.json()
  console.log('[Settings API] Update success:', data)
  return transformSettings(data)
}

/**
 * Settings API namespace for easy import.
 */
export const settingsApi = {
  getSettings,
  updateSettings,
}
