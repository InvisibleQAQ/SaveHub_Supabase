import type { Article } from "../types"
import { supabase } from "../supabase/client"
import { getCurrentUserId, toISOString } from "./core"
import { logger } from "../logger"

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
    content_hash: article.contentHash || null,
    user_id: userId,
  }))

  logger.debug({ userId, articleCount: articles.length }, 'Saving articles')
  const { data, error } = await supabase.from("articles").upsert(dbRows).select()

  if (error) {
    logger.error({ error, userId, articleCount: articles.length }, 'Failed to save articles')
    throw error
  }1

  logger.info({ userId, savedCount: data?.length || 0 }, 'Articles saved successfully')
}

/**
 * Load articles for current user
 * Can filter by feedId and limit results
 */
export async function loadArticles(feedId?: string, limit?: number): Promise<Article[]> {
  logger.debug({ feedId, limit }, 'Loading articles')
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

  if (error) {
    logger.error({ error, feedId, limit }, 'Failed to load articles')
    throw error
  }

  logger.debug({ feedId, limit, articleCount: data?.length || 0 }, 'Articles loaded successfully')
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
    contentHash: row.content_hash || undefined,
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

  logger.debug({ articleId, updateFields: Object.keys(dbUpdates) }, 'Updating article')
  const { error } = await supabase
    .from("articles")
    .update(dbUpdates)
    .eq("id", articleId)

  if (error) {
    logger.error({ error, articleId, updateFields: Object.keys(dbUpdates) }, 'Failed to update article')
    throw error
  }

  logger.debug({ articleId, updatedFields: Object.keys(dbUpdates) }, 'Article updated successfully')
}

/**
 * Delete old read articles that are not starred
 * Returns number of articles deleted
 */
export async function clearOldArticles(daysToKeep = 30): Promise<number> {
  const userId = await getCurrentUserId()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

  logger.debug({ userId, daysToKeep, cutoffDate: cutoffDate.toISOString() }, 'Clearing old articles')

  const { data, error } = await supabase
    .from("articles")
    .delete()
    .lt("published_at", cutoffDate.toISOString())
    .eq("is_read", true)
    .eq("is_starred", false)
    .select("id")

  if (error) {
    logger.error({ error, userId, daysToKeep }, 'Failed to clear old articles')
    throw error
  }

  const deletedCount = data?.length || 0
  logger.info({ userId, daysToKeep, deletedCount }, 'Old articles cleared successfully')
  return deletedCount
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
  const userId = await getCurrentUserId()
  logger.debug({ userId }, 'Calculating article statistics')

  const { data: articles, error } = await supabase
    .from("articles")
    .select("id, feed_id, is_read, is_starred")

  if (error) {
    logger.error({ error, userId }, 'Failed to get article statistics')
    throw error
  }

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

  logger.debug({ userId, stats: { total: stats.total, unread: stats.unread, starred: stats.starred } }, 'Article statistics calculated')
  return stats
}