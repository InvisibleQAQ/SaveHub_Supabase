import { create } from "zustand"
import type { RSSReaderState } from "../types"
import { createFoldersSlice, type FoldersSlice } from "./folders.slice"
import { createFeedsSlice, type FeedsSlice } from "./feeds.slice"
import { createArticlesSlice, type ArticlesSlice } from "./articles.slice"
import { createUISlice, type UISlice } from "./ui.slice"
import { createSettingsSlice, type SettingsSlice } from "./settings.slice"
import { createDatabaseSlice, type DatabaseSlice } from "./database.slice"
import { createApiConfigsSlice, type ApiConfigsSlice } from "./api-configs.slice"

export type RSSReaderStore = RSSReaderState &
  FoldersSlice &
  FeedsSlice &
  ArticlesSlice &
  UISlice &
  SettingsSlice &
  DatabaseSlice &
  ApiConfigsSlice

/**
 * Default settings - inlined to avoid dependency on lib/db
 */
const defaultSettings = {
  id: "app-settings",
  theme: "system" as const,
  fontSize: 16,
  autoRefresh: true,
  refreshInterval: 30,
  articlesRetentionDays: 30,
  markAsReadOnScroll: false,
  showThumbnails: true,
  sidebarPinned: false,
}

export const useRSSStore = create<RSSReaderStore>()((...a) => ({
  ...createDatabaseSlice(...a),
  ...createFoldersSlice(...a),
  ...createFeedsSlice(...a),
  ...createArticlesSlice(...a),
  ...createUISlice(...a),
  ...createSettingsSlice(...a),
  ...createApiConfigsSlice(...a),

  folders: [],
  feeds: [],
  articles: [],
  apiConfigs: [],
  selectedFeedId: null,
  selectedArticleId: null,
  isLoading: false,
  error: null,
  searchQuery: "",
  viewMode: "all",
  settings: defaultSettings,
  isSidebarCollapsed: false,
}))
