import type { Feed } from "../types"
import { createClient } from "../supabase/client"
import { getCurrentUserId, toISOString } from "./core"

/**
 * Save multiple feeds to database
 * Upserts feeds with current user ownership
 */
export async function saveFeeds(feeds: Feed[]): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()
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
    user_id: userId,
    last_fetched: toISOString(feed.lastFetched),
  }))

  console.log(`[DB] Saving ${feeds.length} feeds`)
  const { data, error } = await supabase.from("feeds").upsert(dbRows).select()

  if (error) {
    console.error('[DB] Failed to save feeds:', error)
    if (error.code === '23505') {
      return { success: false, error: 'duplicate' }
    }
    throw error
  }

  console.log(`[DB] Successfully saved ${data?.length || 0} feeds`)
  return { success: true }
}

/**
 * Load all feeds for current user
 * Returns feeds ordered by order field
 */
export async function loadFeeds(): Promise<Feed[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("feeds")
    .select("*")
    .order("order", { ascending: true })

  if (error) throw error

  return (data || []).map(row => ({
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description || undefined,
    category: row.category || undefined,
    folderId: row.folder_id || undefined,
    order: row.order,
    unreadCount: row.unread_count,
    lastFetched: row.last_fetched ? new Date(row.last_fetched) : undefined,
  }))
}

/**
 * Delete a feed and all its articles
 * This will cascade delete due to foreign key constraints
 */
export async function deleteFeed(feedId: string): Promise<void> {
  const supabase = createClient()
  console.log(`[DB] Deleting feed ${feedId}`)

  const { error } = await supabase.from("feeds").delete().eq("id", feedId)

  if (error) {
    console.error('[DB] Failed to delete feed:', error)
    throw error
  }

  console.log('[DB] Successfully deleted feed')
}