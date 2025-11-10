import type { Folder } from "../types"
import { supabase } from "../supabase/client"
import { getCurrentUserId, toISOString } from "./core"

/**
 * Save multiple folders to database
 * Upserts folders with current user ownership
 */
export async function saveFolders(folders: Folder[]): Promise<{ success: boolean; error?: string }> {
  const userId = await getCurrentUserId()

  const dbRows = folders.map(folder => ({
    id: folder.id,
    name: folder.name,
    order: folder.order ?? 0,
    user_id: userId,
    created_at: toISOString(folder.createdAt),
  }))

  console.log(`[DB] Saving ${folders.length} folders`)
  const { data, error } = await supabase.from("folders").upsert(dbRows).select()

  if (error) {
    console.error('[DB] Failed to save folders:', error)
    if (error.code === '23505') {
      return { success: false, error: 'duplicate' }
    }
    throw error
  }

  console.log(`[DB] Successfully saved ${data?.length || 0} folders`)
  return { success: true }
}

/**
 * Load all folders for current user
 * Returns folders ordered by order field
 */
export async function loadFolders(): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .order("order", { ascending: true })

  if (error) throw error

  return (data || []).map(row => ({
    id: row.id,
    name: row.name,
    order: row.order,
    createdAt: new Date(row.created_at),
  }))
}

/**
 * Delete a folder
 * Note: Feeds in this folder will have their folderId set to null
 */
export async function deleteFolder(folderId: string): Promise<void> {
  console.log(`[DB] Deleting folder ${folderId}`)

  const { error } = await supabase.from("folders").delete().eq("id", folderId)

  if (error) {
    console.error('[DB] Failed to delete folder:', error)
    throw error
  }

  console.log('[DB] Successfully deleted folder')
}