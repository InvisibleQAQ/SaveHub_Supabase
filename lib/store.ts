import { create } from "zustand"
import type { Feed, Article, Folder, RSSReaderState } from "./types"
import { dbManager, type AppSettings, defaultSettings } from "./db"

interface RSSReaderActions {
  // Folder management
  addFolder: (folder: Omit<Folder, "id" | "createdAt">) => void
  removeFolder: (folderId: string, deleteFeeds?: boolean) => void
  renameFolder: (folderId: string, newName: string) => void

  // Feed management
  addFeed: (feed: Omit<Feed, "id">) => void
  removeFeed: (feedId: string) => void
  updateFeed: (feedId: string, updates: Partial<Feed>) => void

  // Article management
  addArticles: (articles: Article[]) => void
  markAsRead: (articleId: string) => void
  markAsUnread: (articleId: string) => void
  toggleStar: (articleId: string) => void
  markFeedAsRead: (feedId: string) => void

  // UI state
  setSelectedFeed: (feedId: string | null) => void
  setSelectedArticle: (articleId: string | null) => void
  setSearchQuery: (query: string) => void
  setViewMode: (mode: "all" | "unread" | "starred") => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  isSidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void

  // Settings
  settings: AppSettings
  updateSettings: (updates: Partial<AppSettings>) => void

  // Computed getters
  getFilteredArticles: (options?: { viewMode?: "all" | "unread" | "starred"; feedId?: string | null }) => Article[]
  getUnreadCount: (feedId?: string) => number

  // Database initialization state and methods
  isDatabaseReady: boolean
  setDatabaseReady: (ready: boolean) => void
  checkDatabaseStatus: () => Promise<boolean>

  // Data persistence
  syncToSupabase: () => Promise<void>
  loadFromSupabase: () => Promise<void>
}

export const useRSSStore = create<RSSReaderState & RSSReaderActions>()((set, get) => ({
      // Initial state
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
      isDatabaseReady: false,
      isSidebarCollapsed: false,

      // Folder management actions
      addFolder: (folder) => {
        const newFolder: Folder = {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          ...folder,
        }

        set((state) => ({
          folders: [...state.folders, newFolder],
        }))

        get().syncToSupabase()
      },

      removeFolder: (folderId, deleteFeeds = false) => {
        const folderFeeds = get().feeds.filter((f) => f.folderId === folderId)
        const feedIds = folderFeeds.map((f) => f.id)

        if (deleteFeeds) {
          // Delete folder and all its feeds and articles
          set((state) => ({
            folders: state.folders.filter((f) => f.id !== folderId),
            feeds: state.feeds.filter((f) => f.folderId !== folderId),
            articles: state.articles.filter((a) => !feedIds.includes(a.feedId)),
          }))

          // Delete from database
          Promise.all([
            dbManager.deleteFolder(folderId),
            ...feedIds.map((id) => dbManager.deleteFeed(id)),
          ]).catch(console.error)
        } else {
          // Only delete folder, move feeds out (dissolve)
          set((state) => ({
            folders: state.folders.filter((f) => f.id !== folderId),
            feeds: state.feeds.map((feed) => (feed.folderId === folderId ? { ...feed, folderId: undefined } : feed)),
          }))

          dbManager.deleteFolder(folderId).catch(console.error)
          get().syncToSupabase()
        }
      },

      renameFolder: (folderId, newName) => {
        set((state) => ({
          folders: state.folders.map((folder) => (folder.id === folderId ? { ...folder, name: newName } : folder)),
        }))

        get().syncToSupabase()
      },

      // Feed actions
      addFeed: (feed) => {
        console.log("[v0] Adding feed to store:", feed)

        const newFeed: Feed = {
          id: feed.id || crypto.randomUUID(),
          ...feed,
        }

        console.log("[v0] Created feed with ID:", newFeed.id)

        set((state) => {
          // Check if feed already exists
          const existingFeed = state.feeds.find((f) => f.id === newFeed.id || f.url === newFeed.url)
          if (existingFeed) {
            console.log("[v0] Feed already exists, updating instead")
            return {
              feeds: state.feeds.map((f) => (f.id === existingFeed.id ? { ...f, ...newFeed } : f)),
            }
          }

          console.log("[v0] Adding new feed to state")
          return {
            feeds: [...state.feeds, newFeed],
          }
        })

        get().syncToSupabase()
      },

      removeFeed: (feedId) => {
        set((state) => ({
          feeds: state.feeds.filter((f) => f.id !== feedId),
          articles: state.articles.filter((a) => a.feedId !== feedId),
          selectedFeedId: state.selectedFeedId === feedId ? null : state.selectedFeedId,
        }))

        dbManager.deleteFeed(feedId).catch(console.error)
      },

      updateFeed: (feedId, updates) => {
        set((state) => ({
          feeds: state.feeds.map((f) => (f.id === feedId ? { ...f, ...updates } : f)),
        }))

        get().syncToSupabase()
      },

      // Article actions
      addArticles: (articles) => {
        console.log("[v0] Adding articles to store, count:", articles.length)
        console.log("[v0] Current articles in store:", get().articles.length)

        const currentState = get()
        const existingIds = new Set(currentState.articles.map((a) => a.id))
        const newArticles = articles.filter((a) => !existingIds.has(a.id))

        console.log("[v0] New articles to add:", newArticles.length)

        if (newArticles.length === 0) {
          console.log("[v0] No new articles to add")
          return
        }

        set((state) => {
          console.log("[v0] Adding new articles to state")
          return {
            articles: [...state.articles, ...newArticles],
          }
        })

        console.log("[v0] Saving", newArticles.length, "new articles to Supabase")
        dbManager.saveArticles(newArticles).catch((error) => {
          console.error("[v0] Failed to save articles to Supabase:", error)
        })
      },

      markAsRead: (articleId) => {
        set((state) => ({
          articles: state.articles.map((a) => (a.id === articleId ? { ...a, isRead: true } : a)),
        }))

        dbManager.updateArticle(articleId, { isRead: true }).catch(console.error)
      },

      markAsUnread: (articleId) => {
        set((state) => ({
          articles: state.articles.map((a) => (a.id === articleId ? { ...a, isRead: false } : a)),
        }))

        dbManager.updateArticle(articleId, { isRead: false }).catch(console.error)
      },

      toggleStar: (articleId) => {
        const article = get().articles.find((a) => a.id === articleId)
        if (!article) return

        const newStarredState = !article.isStarred
        console.log("[v0] Toggling star for article:", articleId, "from", article.isStarred, "to", newStarredState)

        set((state) => ({
          articles: state.articles.map((a) => (a.id === articleId ? { ...a, isStarred: newStarredState } : a)),
        }))

        dbManager.updateArticle(articleId, { isStarred: newStarredState }).catch(console.error)

        console.log("[v0] Star toggled successfully")
      },

      markFeedAsRead: (feedId) => {
        const feedArticles = get().articles.filter((a) => a.feedId === feedId && !a.isRead)

        if (feedArticles.length === 0) return

        set((state) => ({
          articles: state.articles.map((a) =>
            a.feedId === feedId && !a.isRead ? { ...a, isRead: true } : a
          ),
        }))

        Promise.all(
          feedArticles.map((article) =>
            dbManager.updateArticle(article.id, { isRead: true })
          )
        ).catch(console.error)
      },

      // UI actions
      setSelectedFeed: (feedId) => {
        set({ selectedFeedId: feedId, selectedArticleId: null })
      },

      setSelectedArticle: (articleId) => {
        set({ selectedArticleId: articleId })
        if (articleId) {
          get().markAsRead(articleId)
        }
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query })
      },

      setViewMode: (mode) => {
        set({ viewMode: mode })
      },

      setLoading: (loading) => {
        set({ isLoading: loading })
      },

      setError: (error) => {
        set({ error })
      },

      toggleSidebar: () => {
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed }))
      },

      setSidebarCollapsed: (collapsed) => {
        set({ isSidebarCollapsed: collapsed })
      },

      // Settings
      updateSettings: (updates) => {
        const newSettings = { ...get().settings, ...updates }
        set({ settings: newSettings })

        dbManager.saveSettings(newSettings).catch(console.error)
      },

      // Computed getters
      getFilteredArticles: (options) => {
        const state = get()
        let filtered = state.articles

        const viewMode = options?.viewMode !== undefined ? options.viewMode : state.viewMode
        const feedId = options?.feedId !== undefined ? options.feedId : state.selectedFeedId

        console.log("[v0] Filtering articles - total articles:", filtered.length)
        console.log("[v0] View mode (from params):", viewMode)
        console.log("[v0] Feed ID (from params):", feedId)

        // Filter by selected feed
        if (feedId) {
          filtered = filtered.filter((a) => a.feedId === feedId)
          console.log("[v0] After feed filter:", filtered.length)
        }

        // Filter by view mode
        switch (viewMode) {
          case "unread":
            filtered = filtered.filter((a) => !a.isRead)
            console.log("[v0] After unread filter:", filtered.length)
            break
          case "starred":
            const starredArticles = filtered.filter((a) => a.isStarred)
            console.log("[v0] Starred articles found:", starredArticles.length)
            console.log(
              "[v0] Starred article IDs:",
              starredArticles.map((a) => a.id),
            )
            filtered = starredArticles
            break
        }

        // Filter by search query
        if (state.searchQuery) {
          const query = state.searchQuery.toLowerCase()
          filtered = filtered.filter(
            (a) =>
              a.title.toLowerCase().includes(query) ||
              a.content.toLowerCase().includes(query) ||
              a.summary?.toLowerCase().includes(query) ||
              a.author?.toLowerCase().includes(query),
          )
          console.log("[v0] After search filter:", filtered.length)
        }

        console.log("[v0] Final filtered articles:", filtered.length)

        // Sort by published date (newest first)
        return filtered.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      },

      getUnreadCount: (feedId) => {
        const state = get()
        const articles = feedId ? state.articles.filter((a) => a.feedId === feedId) : state.articles
        return articles.filter((a) => !a.isRead).length
      },

      // Database initialization methods
      checkDatabaseStatus: async () => {
        try {
          const isReady = await dbManager.isDatabaseInitialized()
          set({ isDatabaseReady: isReady })
          return isReady
        } catch (error) {
          console.error("Error checking database status:", error)
          set({ isDatabaseReady: false })
          return false
        }
      },

      setDatabaseReady: (ready) => {
        set({ isDatabaseReady: ready })
      },

      // Data persistence
      syncToSupabase: async () => {
        if (!get().isDatabaseReady) {
          console.log("[v0] Database not ready, skipping sync")
          return
        }

        try {
          const state = get()
          await Promise.all([
            dbManager.saveFolders(state.folders),
            dbManager.saveFeeds(state.feeds),
            dbManager.saveArticles(state.articles),
            dbManager.saveSettings(state.settings),
          ])
        } catch (error) {
          console.error("Failed to sync to Supabase:", error)
        }
      },

      loadFromSupabase: async () => {
        const isReady = await get().checkDatabaseStatus()

        if (!isReady) {
          console.log("[v0] Database not initialized, skipping load")
          set({
            isLoading: false,
            error: null, // Don't show error if database just isn't set up yet
          })
          return
        }

        try {
          set({ isLoading: true })

          const [folders, feeds, articles, settings] = await Promise.all([
            dbManager.loadFolders(),
            dbManager.loadFeeds(),
            dbManager.loadArticles(),
            dbManager.loadSettings(),
          ])

          set({
            folders: folders || [],
            feeds: feeds || [],
            articles: articles || [],
            settings: settings || defaultSettings,
            isLoading: false,
          })

          // Clean up old articles based on settings
          const retentionDays = settings?.articlesRetentionDays || 30
          const deletedCount = await dbManager.clearOldArticles(retentionDays)

          if (deletedCount > 0) {
            console.log(`Cleaned up ${deletedCount} old articles`)
            // Reload articles after cleanup
            const updatedArticles = await dbManager.loadArticles()
            set({ articles: updatedArticles || [] })
          }
        } catch (error) {
          console.error("Failed to load from Supabase:", error)
          set({
            error: "Failed to load saved data",
            isLoading: false,
          })
        }
      },
    }))
