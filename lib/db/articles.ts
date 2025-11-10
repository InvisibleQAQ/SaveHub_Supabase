import type { Article } from "../types"
import { supabase } from "../supabase/client"
import { getCurrentUserId, toISOString } from "./core"

/**
 * Save multiple articles to database
 * Upserts articles with current user ownership
 */
export async function saveArticles(articles: Article[]): Promise<void> {
  const userId = await getCurrentUserId()

  const dbRows = articles.map(article => ({
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
    user_id: userId,
  }))

  console.log(`[DB] Saving ${articles.length} articles`)
  const { data, error } = await supabase.from("articles").upsert(dbRows).select()

  if (error) {
    console.error('[DB] Failed to save articles:', error)
    throw error
  }

  console.log(`[DB] Successfully saved ${data?.length || 0} articles`)
}

/**
 * Load articles for current user
 * Can filter by feedId and limit results
 */
export async function loadArticles(feedId?: string, limit?: number): Promise<Article[]> {
  let query = supabase
    .from("articles")
    .select("*")
    .order("published_at", { ascending: false })

  if (feedId) {
    query = query.eq("feed_id", feedId)
  }

  if (limit) {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) throw error

  return (data || []).map(row => ({
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
  }))
}

/**
 * Update specific fields of an article
 * Only updates provided fields, leaves others unchanged
 */
export async function updateArticle(articleId: string, updates: Partial<Article>): Promise<void> {
  // Map app field names to database field names
  const dbUpdates: Record<string, any> = {}

  if (updates.isRead !== undefined) dbUpdates.is_read = updates.isRead
  if (updates.isStarred !== undefined) dbUpdates.is_starred = updates.isStarred
  if (updates.title !== undefined) dbUpdates.title = updates.title
  if (updates.content !== undefined) dbUpdates.content = updates.content
  if (updates.summary !== undefined) dbUpdates.summary = updates.summary
  if (updates.url !== undefined) dbUpdates.url = updates.url
  if (updates.author !== undefined) dbUpdates.author = updates.author
  if (updates.publishedAt !== undefined) dbUpdates.published_at = toISOString(updates.publishedAt)
  if (updates.thumbnail !== undefined) dbUpdates.thumbnail = updates.thumbnail

  console.log(`[DB] Updating article ${articleId} with:`, dbUpdates)
  const { error } = await supabase
    .from("articles")
    .update(dbUpdates)
    .eq("id", articleId)

  if (error) {
    console.error('[DB] Failed to update article:', error)
    throw error
  }

  console.log('[DB] Successfully updated article')
}

/**
 * Delete old read articles that are not starred
 * Returns number of articles deleted
 */
export async function clearOldArticles(daysToKeep = 30): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

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

/**
 * Get article statistics for current user
 * Returns total, unread, starred counts and per-feed breakdown
 */
export async function getArticleStats(): Promise<{
  total: number
  unread: number
  starred: number
  byFeed: Record<string, { total: number; unread: number }>
}> {
  const { data: articles, error } = await supabase
    .from("articles")
    .select("id, feed_id, is_read, is_starred")

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