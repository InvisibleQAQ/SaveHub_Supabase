import type { ApiConfig } from "../types"
import { supabase } from "../supabase/client"
import { getCurrentUserId, toISOString } from "./core"
import { encrypt, decrypt, isEncrypted } from "../encryption"
import { logger } from "../logger"

/**
 * Save multiple API configs to database
 * Encrypts apiKey and apiBase before storage
 */
export async function saveApiConfigs(configs: ApiConfig[]): Promise<{ success: boolean; error?: string }> {
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

    logger.debug({ userId, configCount: configs.length }, 'Saving API configs (encrypted)')
    const { data, error } = await supabase.from("api_configs").upsert(dbRows).select()

    if (error) {
      logger.error({ error, userId, configCount: configs.length }, 'Failed to save API configs')
      return { success: false, error: error.message }
    }

    logger.info({ userId, savedCount: data?.length || 0 }, 'API configs saved successfully')
    return { success: true }
  } catch (error) {
    logger.error({ error, userId, configCount: configs.length }, 'Error saving API configs')
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
  const userId = await getCurrentUserId()

  logger.debug({ userId }, 'Loading API configs')

  try {
    const { data, error } = await supabase
      .from("api_configs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      logger.error({ error, userId }, 'Error loading API configs')
      throw error
    }

    logger.debug({ userId, configCount: data?.length || 0 }, 'Loaded API configs from database')

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
          logger.warn({ configId: row.id, userId }, 'Migrating plaintext API key')
          apiKey = row.api_key // Keep plaintext for now, will encrypt on next save
          needsMigration = true
        } else {
          try {
            apiKey = await decrypt(row.api_key)
          } catch (decryptError) {
            logger.error({ error: decryptError, configId: row.id, userId }, 'Failed to decrypt API key, deleting corrupted data')
            // Delete corrupted config from database
            await supabase.from("api_configs").delete().eq("id", row.id)
            continue // Skip this config
          }
        }

        if (!isEncrypted(row.api_base)) {
          logger.warn({ configId: row.id, userId }, 'Migrating plaintext API base')
          apiBase = row.api_base // Keep plaintext for now, will encrypt on next save
          needsMigration = true
        } else {
          try {
            apiBase = await decrypt(row.api_base)
          } catch (decryptError) {
            logger.error({ error: decryptError, configId: row.id, userId }, 'Failed to decrypt API base, deleting corrupted data')
            // Delete corrupted config from database
            await supabase.from("api_configs").delete().eq("id", row.id)
            continue // Skip this config
          }
        }

        // Auto-migrate: re-save with encryption if legacy plaintext detected
        if (needsMigration) {
          logger.info({ configId: row.id, userId }, 'Auto-encrypting legacy config')
          // We'll trigger a re-save by returning the config,
          // and the calling code should save it back
          setTimeout(async () => {
            try {
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
              logger.info({ configId: row.id, userId }, 'Legacy config auto-migration completed')
            } catch (migrationError) {
              logger.error({ error: migrationError, configId: row.id, userId }, 'Legacy config auto-migration failed')
            }
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
        logger.error({ error, configId: row.id, userId }, 'Error processing API config, skipping')
        // Skip corrupted configs
        continue
      }
    }

    logger.info({ userId, loadedCount: configs.length }, 'API configs loaded and decrypted successfully')
    return configs
  } catch (error) {
    logger.error({ error, userId }, 'Fatal error loading API configs')
    return []
  }
}

/**
 * Delete an API config
 */
export async function deleteApiConfig(configId: string): Promise<void> {
  const userId = await getCurrentUserId()
  logger.debug({ configId, userId }, 'Deleting API config')

  const { error } = await supabase.from("api_configs").delete().eq("id", configId)

  if (error) {
    logger.error({ error, configId, userId }, 'Failed to delete API config')
    throw error
  }

  logger.info({ configId, userId }, 'API config deleted successfully')
}