import type { Feed } from "../types"
import { supabase } from "../supabase/client"
import { getCurrentUserId, toISOString } from "./core"
import { logger } from "../logger"

/**
 * Save multiple feeds to database
 * Upserts feeds with current user ownership
 */
export async function saveFeeds(feeds: Feed[]): Promise<{ success: boolean; error?: string }> {
  const userId = await getCurrentUserId()

  const dbRows = feeds.map(feed => ({
    id: feed.id,
    title: feed.title,
    url: feed.url,
    description: feed.description || null,
    category: feed.category || null,
    folder_id: feed.folderId || null,
    order: feed.order ?? 0,
    unread_count: feed.unreadCount ?? 0,
    refresh_interval: feed.refreshInterval ?? 60,
    user_id: userId,
    last_fetched: toISOString(feed.lastFetched),
    last_fetch_status: feed.lastFetchStatus || null,
    last_fetch_error: feed.lastFetchError || null,
  }))

  logger.debug({ userId, feedCount: feeds.length }, 'Saving feeds')
  const { data, error } = await supabase.from("feeds").upsert(dbRows).select()

  if (error) {
    logger.error({ error, userId, feedCount: feeds.length }, 'Failed to save feeds')
    if (error.code === '23505') {
      return { success: false, error: 'duplicate' }
    }
    throw error
  }

  logger.info({ userId, savedCount: data?.length || 0 }, 'Feeds saved successfully')
  return { success: true }
}

/**
 * Load all feeds for current user
 * Returns feeds ordered by order field
 */
export async function loadFeeds(): Promise<Feed[]> {
  logger.debug('Loading feeds')
  const { data, error } = await supabase
    .from("feeds")
    .select("*")
    .order("order", { ascending: true })

  if (error) {
    logger.error({ error }, 'Failed to load feeds')
    throw error
  }

  logger.debug({ feedCount: data?.length || 0 }, 'Feeds loaded successfully')
  return (data || []).map(row => ({
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description || undefined,
    category: row.category || undefined,
    folderId: row.folder_id || undefined,
    order: row.order,
    unreadCount: row.unread_count,
    refreshInterval: row.refresh_interval,
    lastFetched: row.last_fetched ? new Date(row.last_fetched) : undefined,
    lastFetchStatus: row.last_fetch_status || undefined,
    lastFetchError: row.last_fetch_error || undefined,
  }))
}

/**
 * Update a single feed
 * Allows partial updates of feed properties
 */
export async function updateFeed(feedId: string, updates: Partial<Feed>): Promise<{ success: boolean; error?: string }> {
  const userId = await getCurrentUserId()

  const updateData: any = {}

  if (updates.title !== undefined) updateData.title = updates.title
  if (updates.url !== undefined) updateData.url = updates.url
  if (updates.description !== undefined) updateData.description = updates.description || null
  if (updates.category !== undefined) updateData.category = updates.category || null
  if (updates.folderId !== undefined) updateData.folder_id = updates.folderId || null
  if (updates.order !== undefined) updateData.order = updates.order
  if (updates.unreadCount !== undefined) updateData.unread_count = updates.unreadCount
  if (updates.refreshInterval !== undefined) updateData.refresh_interval = updates.refreshInterval
  if (updates.lastFetched !== undefined) updateData.last_fetched = toISOString(updates.lastFetched)
  if (updates.lastFetchStatus !== undefined) updateData.last_fetch_status = updates.lastFetchStatus || null
  if (updates.lastFetchError !== undefined) updateData.last_fetch_error = updates.lastFetchError || null

  logger.debug({ feedId, userId, updateFields: Object.keys(updateData) }, 'Updating feed')

  const { error } = await supabase
    .from("feeds")
    .update(updateData)
    .eq("id", feedId)
    .eq("user_id", userId)

  if (error) {
    logger.error({ error, feedId, userId }, 'Failed to update feed')
    if (error.code === '23505') {
      return { success: false, error: 'duplicate' }
    }
    throw error
  }

  logger.info({ feedId, userId, updatedFields: Object.keys(updateData) }, 'Feed updated successfully')
  return { success: true }
}

/**
 * Delete a feed and all its articles
 * Explicitly deletes articles first for better logging and tracking
 * Returns deletion statistics
 */
export async function deleteFeed(feedId: string): Promise<{ articlesDeleted: number; feedDeleted: boolean }> {
  const userId = await getCurrentUserId()
  logger.debug({ feedId, userId }, 'Starting feed deletion')

  // Step 1: Count and delete articles associated with this feed
  const { data: articlesToDelete, error: countError } = await supabase
    .from("articles")
    .select("id")
    .eq("feed_id", feedId)
    .eq("user_id", userId)

  if (countError) {
    logger.error({ error: countError, feedId, userId }, 'Failed to query articles for deletion')
    throw countError
  }

  const articleCount = articlesToDelete?.length || 0
  logger.debug({ feedId, userId, articleCount }, 'Found articles to delete')

  // Delete articles if any exist
  let articlesDeleted = 0
  if (articleCount > 0) {
    const { error: deleteArticlesError } = await supabase
      .from("articles")
      .delete()
      .eq("feed_id", feedId)
      .eq("user_id", userId)

    if (deleteArticlesError) {
      logger.error({ error: deleteArticlesError, feedId, userId, articleCount }, 'Failed to delete articles')
      throw deleteArticlesError
    }

    articlesDeleted = articleCount
    logger.info({ feedId, userId, articlesDeleted }, 'Articles deleted successfully')
  }

  // Step 2: Delete the feed itself (user-scoped for security)
  const { error: deleteFeedError } = await supabase
    .from("feeds")
    .delete()
    .eq("id", feedId)
    .eq("user_id", userId)

  if (deleteFeedError) {
    logger.error({ error: deleteFeedError, feedId, userId }, 'Failed to delete feed')
    throw deleteFeedError
  }

  logger.info({ feedId, userId, articlesDeleted, feedDeleted: true }, 'Feed and associated articles deleted successfully')
  return { articlesDeleted, feedDeleted: true }
}