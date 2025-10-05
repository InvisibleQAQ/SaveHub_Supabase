import type { ApiConfig } from "../types"
import { createClient } from "../supabase/client"
import { getCurrentUserId, toISOString } from "./core"

/**
 * Save multiple API configs to database
 */
export async function saveApiConfigs(configs: ApiConfig[]): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()
  const userId = await getCurrentUserId()

  try {
    const dbRows = configs.map((config) => ({
      id: config.id,
      name: config.name,
      api_key: config.apiKey,
      api_base: config.apiBase,
      model: config.model,
      is_default: config.isDefault,
      is_active: config.isActive,
      user_id: userId,
      created_at: toISOString(config.createdAt),
    }))

    console.log(`[DB] Saving ${configs.length} API configs`)
    const { data, error } = await supabase.from("api_configs").upsert(dbRows).select()

    if (error) {
      console.error('[DB] Failed to save API configs:', error)
      return { success: false, error: error.message }
    }

    console.log(`[DB] Successfully saved ${data?.length || 0} API configs`)
    return { success: true }
  } catch (error) {
    console.error('[DB] Error saving API configs:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }
  }
}

/**
 * Load all API configs for current user
 */
export async function loadApiConfigs(): Promise<ApiConfig[]> {
  const supabase = createClient()

  try {
    const { data, error } = await supabase
      .from("api_configs")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) throw error

    if (!data || data.length === 0) {
      return []
    }

    const configs = data.map((row) => ({
      id: row.id,
      name: row.name,
      apiKey: row.api_key,
      apiBase: row.api_base,
      model: row.model,
      isDefault: row.is_default,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
    }))

    return configs
  } catch (error) {
    console.error('[DB] Error loading API configs:', error)
    return []
  }
}

/**
 * Delete an API config
 */
export async function deleteApiConfig(configId: string): Promise<void> {
  const supabase = createClient()
  console.log(`[DB] Deleting API config ${configId}`)

  const { error } = await supabase.from("api_configs").delete().eq("id", configId)

  if (error) {
    console.error('[DB] Failed to delete API config:', error)
    throw error
  }

  console.log('[DB] Successfully deleted API config')
}