import type { ApiConfig } from "../types"
import { createClient } from "../supabase/client"
import { getCurrentUserId, toISOString } from "./core"
import { encrypt, decrypt, isEncrypted } from "../encryption"

/**
 * Save multiple API configs to database
 * Encrypts apiKey and apiBase before storage
 */
export async function saveApiConfigs(configs: ApiConfig[]): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()
  const userId = await getCurrentUserId()

  try {
    // Encrypt sensitive fields before saving
    const dbRows = await Promise.all(configs.map(async (config) => ({
      id: config.id,
      name: config.name,
      api_key: await encrypt(config.apiKey),
      api_base: await encrypt(config.apiBase),
      model: config.model,
      is_default: config.isDefault,
      is_active: config.isActive,
      user_id: userId,
      created_at: toISOString(config.createdAt),
    })))

    console.log(`[DB] Saving ${configs.length} API configs (encrypted)`)
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
 * Decrypts apiKey and apiBase after retrieval
 * Handles legacy plaintext data by auto-encrypting on first load
 */
export async function loadApiConfigs(): Promise<ApiConfig[]> {
  const supabase = createClient()
  const userId = await getCurrentUserId()

  console.log('[DB] Loading API configs for user:', userId)

  try {
    const { data, error } = await supabase
      .from("api_configs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      console.error('[DB] Error loading API configs:', error)
      throw error
    }

    console.log('[DB] Loaded API configs:', data?.length || 0, 'configs')

    if (!data || data.length === 0) {
      return []
    }

    // Decrypt configs and handle legacy plaintext data
    const configs: ApiConfig[] = []

    for (const row of data) {
      try {
        let apiKey = row.api_key
        let apiBase = row.api_base
        let needsMigration = false

        // Check if data is already encrypted
        if (!isEncrypted(row.api_key)) {
          console.warn(`[DB] Migrating plaintext API key for config ${row.id}`)
          apiKey = row.api_key // Keep plaintext for now, will encrypt on next save
          needsMigration = true
        } else {
          try {
            apiKey = await decrypt(row.api_key)
          } catch (decryptError) {
            console.error(`[DB] Failed to decrypt API key for config ${row.id}, deleting corrupted data`)
            // Delete corrupted config from database
            await supabase.from("api_configs").delete().eq("id", row.id)
            continue // Skip this config
          }
        }

        if (!isEncrypted(row.api_base)) {
          console.warn(`[DB] Migrating plaintext API base for config ${row.id}`)
          apiBase = row.api_base // Keep plaintext for now, will encrypt on next save
          needsMigration = true
        } else {
          try {
            apiBase = await decrypt(row.api_base)
          } catch (decryptError) {
            console.error(`[DB] Failed to decrypt API base for config ${row.id}, deleting corrupted data`)
            // Delete corrupted config from database
            await supabase.from("api_configs").delete().eq("id", row.id)
            continue // Skip this config
          }
        }

        // Auto-migrate: re-save with encryption if legacy plaintext detected
        if (needsMigration) {
          console.log(`[DB] Auto-encrypting legacy config ${row.id}`)
          // We'll trigger a re-save by returning the config,
          // and the calling code should save it back
          setTimeout(async () => {
            await saveApiConfigs([{
              id: row.id,
              name: row.name,
              apiKey,
              apiBase,
              model: row.model,
              isDefault: row.is_default,
              isActive: row.is_active,
              createdAt: new Date(row.created_at),
            }])
          }, 0)
        }

        configs.push({
          id: row.id,
          name: row.name,
          apiKey,
          apiBase,
          model: row.model,
          isDefault: row.is_default,
          isActive: row.is_active,
          createdAt: new Date(row.created_at),
        })
      } catch (error) {
        console.error(`[DB] Error processing config ${row.id}:`, error)
        // Skip corrupted configs
        continue
      }
    }

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