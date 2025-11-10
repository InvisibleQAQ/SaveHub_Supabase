// Re-export all individual module functions
export * from "./core"
export * from "./feeds"
export * from "./articles"
export * from "./folders"
export * from "./settings"
export * from "./api-configs"

// Import all functions for the manager class
import type { Feed, Article, Folder, ApiConfig } from "../types"
import { createClient } from "../supabase/client"
import { isDatabaseInitialized } from "./core"
import { saveFeeds, loadFeeds, deleteFeed, updateFeed } from "./feeds"
import { saveArticles, loadArticles, updateArticle, clearOldArticles, getArticleStats } from "./articles"
import { saveFolders, loadFolders, deleteFolder } from "./folders"
import { saveSettings, loadSettings, defaultSettings, type AppSettings } from "./settings"
import { saveApiConfigs, loadApiConfigs, deleteApiConfig } from "./api-configs"

/**
 * Backward-compatible SupabaseManager class
 * Maintains same API as original implementation
 */
class SupabaseManager {
  // Folder operations
  async saveFolders(folders: Folder[]): Promise<{ success: boolean; error?: string }> {
    return saveFolders(folders)
  }

  async loadFolders(): Promise<Folder[]> {
    return loadFolders()
  }

  async deleteFolder(folderId: string): Promise<void> {
    return deleteFolder(folderId)
  }

  // Feed operations
  async saveFeeds(feeds: Feed[]): Promise<void> {
    const result = await saveFeeds(feeds)
    if (!result.success) {
      throw new Error(result.error || 'Failed to save feeds')
    }
  }

  async loadFeeds(): Promise<Feed[]> {
    return loadFeeds()
  }

  async deleteFeed(feedId: string): Promise<void> {
    return deleteFeed(feedId)
  }

  async updateFeed(feedId: string, updates: Partial<Feed>): Promise<{ success: boolean; error?: string }> {
    return updateFeed(feedId, updates)
  }

  // Article operations
  async saveArticles(articles: Article[]): Promise<void> {
    return saveArticles(articles)
  }

  async loadArticles(feedId?: string, limit?: number): Promise<Article[]> {
    return loadArticles(feedId, limit)
  }

  async updateArticle(articleId: string, updates: Partial<Article>): Promise<void> {
    return updateArticle(articleId, updates)
  }

  async clearOldArticles(daysToKeep = 30): Promise<number> {
    return clearOldArticles(daysToKeep)
  }

  async getArticleStats(): Promise<{
    total: number
    unread: number
    starred: number
    byFeed: Record<string, { total: number; unread: number }>
  }> {
    return getArticleStats()
  }

  // Settings operations
  async saveSettings(settings: AppSettings): Promise<void> {
    return saveSettings(settings)
  }

  async loadSettings(): Promise<AppSettings | null> {
    return loadSettings()
  }

  // API Config operations
  async saveApiConfigs(configs: ApiConfig[]): Promise<void> {
    const result = await saveApiConfigs(configs)
    if (!result.success) {
      throw new Error(result.error || 'Failed to save API configs')
    }
  }

  async loadApiConfigs(): Promise<ApiConfig[]> {
    return loadApiConfigs()
  }

  async deleteApiConfig(configId: string): Promise<void> {
    return deleteApiConfig(configId)
  }

  // Database maintenance
  async exportData(): Promise<{
    folders: Folder[]
    feeds: Feed[]
    articles: Article[]
    settings: AppSettings | null
    apiConfigs: ApiConfig[]
  }> {
    const [folders, feeds, articles, settings, apiConfigs] = await Promise.all([
      this.loadFolders(),
      this.loadFeeds(),
      this.loadArticles(),
      this.loadSettings(),
      this.loadApiConfigs(),
    ])

    return { folders, feeds, articles, settings, apiConfigs }
  }

  async importData(data: {
    folders?: Folder[]
    feeds?: Feed[]
    articles?: Article[]
    settings?: AppSettings
    apiConfigs?: ApiConfig[]
  }): Promise<void> {
    const promises: Promise<void>[] = []

    if (data.folders) {
      promises.push(this.saveFolders(data.folders).then(() => {}))
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

    if (data.apiConfigs) {
      promises.push(this.saveApiConfigs(data.apiConfigs))
    }

    await Promise.all(promises)
  }

  async clearAllData(): Promise<void> {
    const supabase = createClient()

    // Delete in order to respect foreign key constraints
    await supabase.from("articles").delete().neq("id", "00000000-0000-0000-0000-000000000000")
    await supabase.from("feeds").delete().neq("id", "00000000-0000-0000-0000-000000000000")
    await supabase.from("folders").delete().neq("id", "00000000-0000-0000-0000-000000000000")
    await supabase.from("api_configs").delete().neq("id", "00000000-0000-0000-0000-000000000000")
    await supabase.from("settings").delete().neq("id", "never-match")
  }

  async isDatabaseInitialized(): Promise<boolean> {
    return isDatabaseInitialized()
  }
}

// Export singleton instance for backward compatibility
export const dbManager = new SupabaseManager()

// Export default settings
export { defaultSettings }