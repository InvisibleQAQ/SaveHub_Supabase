import { create } from "zustand"
import type { RSSReaderState } from "../types"
import { defaultSettings } from "../db"
import { createFoldersSlice, type FoldersSlice } from "./folders.slice"
import { createFeedsSlice, type FeedsSlice } from "./feeds.slice"
import { createArticlesSlice, type ArticlesSlice } from "./articles.slice"
import { createUISlice, type UISlice } from "./ui.slice"
import { createSettingsSlice, type SettingsSlice } from "./settings.slice"
import { createDatabaseSlice, type DatabaseSlice } from "./database.slice"

export type RSSReaderStore = RSSReaderState &
  FoldersSlice &
  FeedsSlice &
  ArticlesSlice &
  UISlice &
  SettingsSlice &
  DatabaseSlice

export const useRSSStore = create<RSSReaderStore>()((...a) => ({
  ...createDatabaseSlice(...a),
  ...createFoldersSlice(...a),
  ...createFeedsSlice(...a),
  ...createArticlesSlice(...a),
  ...createUISlice(...a),
  ...createSettingsSlice(...a),

  folders: [],
  feeds: [],
  articles: [],
  selectedFeedId: null,
  selectedArticleId: null,
  isLoading: false,
  error: null,
  searchQuery: "",
  viewMode: "all",
  settings: defaultSettings,
  isSidebarCollapsed: false,
}))
