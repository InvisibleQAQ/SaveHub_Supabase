import type { Feed, Article, Folder } from "./types"
import { createClient } from "./supabase/client"
import type { Database } from "./supabase/types"

export interface AppSettings {
  id: string
  theme: "light" | "dark" | "system"
  fontSize: number
  autoRefresh: boolean
  refreshInterval: number
  articlesRetentionDays: number
  markAsReadOnScroll: boolean
  showThumbnails: boolean
}

/**
 * Safely converts a Date object or date string to ISO string format
 * Handles both Date objects and already-stringified dates from JSON serialization
 */
function toISOString(date: Date | string | undefined | null): string | null {
  if (!date) return null
  if (typeof date === "string") return date
  if (date instanceof Date) return date.toISOString()
  return null
}

type DbRow = Record<string, any>

class GenericRepository<TApp, TDb extends DbRow = DbRow> {
  constructor(
    private tableName: string,
    private toDb: (item: TApp) => TDb,
    private fromDb: (row: TDb) => TApp,
    private orderBy?: { column: string; ascending: boolean },
  ) {}

  async save(items: TApp[]): Promise<void> {
    const supabase = createClient()
    const dbItems = items.map(this.toDb)
    console.log(`[DB] Saving ${items.length} items to ${this.tableName}`)
    const { data, error } = await supabase.from(this.tableName).upsert(dbItems).select()
    if (error) {
      console.error(`[DB] Failed to save to ${this.tableName}:`, error)
      throw error
    }
    console.log(`[DB] Successfully saved ${data?.length || 0} items to ${this.tableName}`)
  }

  async load(): Promise<TApp[]> {
    const supabase = createClient()
    let query = supabase.from(this.tableName).select("*")

    if (this.orderBy) {
      query = query.order(this.orderBy.column, { ascending: this.orderBy.ascending })
    }

    const { data, error } = await query
    if (error) throw error
    return (data || []).map(this.fromDb)
  }

  async delete(id: string): Promise<void> {
    const supabase = createClient()
    console.log(`[DB] Deleting item ${id} from ${this.tableName}`)
    const { error } = await supabase.from(this.tableName).delete().eq("id", id)
    if (error) {
      console.error(`[DB] Failed to delete from ${this.tableName}:`, error)
      throw error
    }
    console.log(`[DB] Successfully deleted from ${this.tableName}`)
  }
}

function folderToDb(folder: Folder): DbRow {
  return {
    id: folder.id,
    name: folder.name,
    order: folder.order ?? 0,
    created_at: toISOString(folder.createdAt),
  }
}

function dbRowToFolder(row: Database["public"]["Tables"]["folders"]["Row"]): Folder {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    createdAt: new Date(row.created_at),
  }
}

function feedToDb(feed: Feed): DbRow {
  return {
    id: feed.id,
    title: feed.title,
    url: feed.url,
    description: feed.description || null,
    category: feed.category || null,
    folder_id: feed.folderId || null,
    order: feed.order ?? 0,
    unread_count: feed.unreadCount ?? 0,
    last_fetched: toISOString(feed.lastFetched),
  }
}

function dbRowToFeed(row: Database["public"]["Tables"]["feeds"]["Row"]): Feed {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description || undefined,
    category: row.category || undefined,
    folderId: row.folder_id || undefined,
    order: row.order,
    unreadCount: row.unread_count,
    lastFetched: row.last_fetched ? new Date(row.last_fetched) : undefined,
  }
}

function articleToDb(article: Article): DbRow {
  return {
    id: article.id,
    feed_id: article.feedId,
    title: article.title,
    content: article.content,
    summary: article.summary || null,
    url: article.url,
    author: article.author || null,
    published_at: toISOString(article.publishedAt),
    is_read: article.isRead,
    is_starred: article.isStarred,
    thumbnail: article.thumbnail || null,
  }
}

function articlePartialToDb(updates: Partial<Article>): DbRow {
  const dbUpdates: DbRow = {}
  const fieldMap: Record<string, string> = {
    isRead: "is_read",
    isStarred: "is_starred",
    title: "title",
    content: "content",
    summary: "summary",
    url: "url",
    author: "author",
    publishedAt: "published_at",
    thumbnail: "thumbnail",
  }

  for (const [appKey, dbKey] of Object.entries(fieldMap)) {
    const value = updates[appKey as keyof Article]
    if (value !== undefined) {
      dbUpdates[dbKey] = value instanceof Date ? toISOString(value) : value
    }
  }

  return dbUpdates
}

function dbRowToArticle(row: Database["public"]["Tables"]["articles"]["Row"]): Article {
  return {
    id: row.id,
    feedId: row.feed_id,
    title: row.title,
    content: row.content,
    summary: row.summary || undefined,
    url: row.url,
    author: row.author || undefined,
    publishedAt: new Date(row.published_at),
    isRead: row.is_read,
    isStarred: row.is_starred,
    thumbnail: row.thumbnail || undefined,
  }
}

function dbRowToSettings(row: Database["public"]["Tables"]["settings"]["Row"]): AppSettings {
  return {
    id: row.id,
    theme: row.theme as "light" | "dark" | "system",
    fontSize: row.font_size,
    autoRefresh: row.auto_refresh,
    refreshInterval: row.refresh_interval,
    articlesRetentionDays: row.articles_retention_days,
    markAsReadOnScroll: row.mark_as_read_on_scroll,
    showThumbnails: row.show_thumbnails,
  }
}

class SupabaseManager {
  private foldersRepo = new GenericRepository(
    "folders",
    folderToDb,
    dbRowToFolder,
    { column: "order", ascending: true },
  )

  private feedsRepo = new GenericRepository(
    "feeds",
    feedToDb,
    dbRowToFeed,
    { column: "order", ascending: true },
  )

  private articlesRepo = new GenericRepository("articles", articleToDb, dbRowToArticle, {
    column: "published_at",
    ascending: false,
  })

  async saveFolders(folders: Folder[]): Promise<void> {
    return this.foldersRepo.save(folders)
  }

  async loadFolders(): Promise<Folder[]> {
    return this.foldersRepo.load()
  }

  async deleteFolder(folderId: string): Promise<void> {
    return this.foldersRepo.delete(folderId)
  }

  async saveFeeds(feeds: Feed[]): Promise<void> {
    return this.feedsRepo.save(feeds)
  }

  async loadFeeds(): Promise<Feed[]> {
    return this.feedsRepo.load()
  }

  async deleteFeed(feedId: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.from("feeds").delete().eq("id", feedId)
    if (error) throw error
  }

  async saveArticles(articles: Article[]): Promise<void> {
    return this.articlesRepo.save(articles)
  }

  async loadArticles(feedId?: string, limit?: number): Promise<Article[]> {
    const supabase = createClient()

    let query = supabase.from("articles").select("*").order("published_at", { ascending: false })

    if (feedId) {
      query = query.eq("feed_id", feedId)
    }

    if (limit) {
      query = query.limit(limit)
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []).map(dbRowToArticle)
  }

  async updateArticle(articleId: string, updates: Partial<Article>): Promise<void> {
    const supabase = createClient()
    const dbUpdates = articlePartialToDb(updates)
    console.log(`[DB] Updating article ${articleId} with:`, dbUpdates)
    const { error } = await supabase.from("articles").update(dbUpdates).eq("id", articleId)
    if (error) {
      console.error('[DB] Failed to update article:', error)
      throw error
    }
    console.log('[DB] Successfully updated article')
  }

  async clearOldArticles(daysToKeep = 30): Promise<number> {
    const supabase = createClient()

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

    // Delete old read articles that are not starred
    const { data, error } = await supabase
      .from("articles")
      .delete()
      .lt("published_at", cutoffDate.toISOString())
      .eq("is_read", true)
      .eq("is_starred", false)
      .select("id")

    if (error) throw error
    return data?.length || 0
  }

  async getArticleStats(): Promise<{
    total: number
    unread: number
    starred: number
    byFeed: Record<string, { total: number; unread: number }>
  }> {
    const supabase = createClient()

    const { data: articles, error } = await supabase.from("articles").select("id, feed_id, is_read, is_starred")

    if (error) throw error

    const stats = {
      total: articles?.length || 0,
      unread: 0,
      starred: 0,
      byFeed: {} as Record<string, { total: number; unread: number }>,
    }

    articles?.forEach((article) => {
      if (!article.is_read) stats.unread++
      if (article.is_starred) stats.starred++

      if (!stats.byFeed[article.feed_id]) {
        stats.byFeed[article.feed_id] = { total: 0, unread: 0 }
      }

      stats.byFeed[article.feed_id].total++
      if (!article.is_read) {
        stats.byFeed[article.feed_id].unread++
      }
    })

    return stats
  }

  // Settings operations
  async saveSettings(settings: AppSettings): Promise<void> {
    const supabase = createClient()

    const dbSettings = {
      id: settings.id,
      theme: settings.theme,
      font_size: settings.fontSize,
      auto_refresh: settings.autoRefresh,
      refresh_interval: settings.refreshInterval,
      articles_retention_days: settings.articlesRetentionDays,
      mark_as_read_on_scroll: settings.markAsReadOnScroll,
      show_thumbnails: settings.showThumbnails,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from("settings").upsert(dbSettings)

    if (error) throw error
  }

  async loadSettings(): Promise<AppSettings | null> {
    const supabase = createClient()

    const { data, error } = await supabase.from("settings").select("*").eq("id", "app-settings").single()

    if (error) {
      if (error.code === "PGRST116") {
        // No settings found, return null
        return null
      }
      throw error
    }

    return data ? dbRowToSettings(data) : null
  }

  // Database maintenance
  async exportData(): Promise<{
    folders: Folder[]
    feeds: Feed[]
    articles: Article[]
    settings: AppSettings | null
  }> {
    const [folders, feeds, articles, settings] = await Promise.all([
      this.loadFolders(),
      this.loadFeeds(),
      this.loadArticles(),
      this.loadSettings(),
    ])

    return { folders, feeds, articles, settings }
  }

  async importData(data: {
    folders?: Folder[]
    feeds?: Feed[]
    articles?: Article[]
    settings?: AppSettings
  }): Promise<void> {
    const promises: Promise<void>[] = []

    if (data.folders) {
      promises.push(this.saveFolders(data.folders))
    }

    if (data.feeds) {
      promises.push(this.saveFeeds(data.feeds))
    }

    if (data.articles) {
      promises.push(this.saveArticles(data.articles))
    }

    if (data.settings) {
      promises.push(this.saveSettings(data.settings))
    }

    await Promise.all(promises)
  }

  async clearAllData(): Promise<void> {
    const supabase = createClient()

    // Delete in order to respect foreign key constraints
    await supabase.from("articles").delete().neq("id", "00000000-0000-0000-0000-000000000000")
    await supabase.from("feeds").delete().neq("id", "00000000-0000-0000-0000-000000000000")
    await supabase.from("folders").delete().neq("id", "00000000-0000-0000-0000-000000000000")
    await supabase.from("settings").delete().neq("id", "never-match")
  }

  async isDatabaseInitialized(): Promise<boolean> {
    try {
      const supabase = createClient()

      // Try to query the settings table - if it exists, database is initialized
      const { error } = await supabase.from("settings").select("id").limit(1)

      // If there's no error, or if the error is just "no rows", the table exists
      if (!error || error.code === "PGRST116") {
        return true
      }

      // Check for specific "table does not exist" errors
      if (error.message?.includes("does not exist") || error.message?.includes("schema cache")) {
        return false
      }

      // For other errors, assume not initialized
      return false
    } catch (error) {
      console.error("Error checking database initialization:", error)
      return false
    }
  }
}

export const dbManager = new SupabaseManager()

export const defaultSettings: AppSettings = {
  id: "app-settings",
  theme: "system",
  fontSize: 16,
  autoRefresh: true,
  refreshInterval: 30,
  articlesRetentionDays: 30,
  markAsReadOnScroll: false,
  showThumbnails: true,
}
