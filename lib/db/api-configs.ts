import type { ApiConfig } from "../types"
import { createClient } from "../supabase/client"
import { getCurrentUserId, toISOString } from "./core"
import { encryptText, decryptText } from "../crypto"

// 临时密码管理 - 在实际应用中应该有更安全的密钥管理
let masterPassword: string | null = null

/**
 * 设置主密码用于加密/解密
 */
export function setMasterPassword(password: string): void {
  masterPassword = password
}

/**
 * 获取主密码，如果没有则抛出错误
 */
function getMasterPassword(): string {
  if (!masterPassword) {
    throw new Error("主密码未设置，无法加密/解密API配置")
  }
  return masterPassword
}

/**
 * Save multiple API configs to database
 * Encrypts sensitive fields before storage
 */
export async function saveApiConfigs(configs: ApiConfig[]): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()
  const userId = await getCurrentUserId()

  try {
    const password = getMasterPassword()

    const dbRows = await Promise.all(configs.map(async (config) => ({
      id: config.id,
      name: config.name,
      api_key: await encryptText(config.apiKey, password),
      api_base: await encryptText(config.apiBase, password),
      model: config.model,
      is_default: config.isDefault,
      is_active: config.isActive,
      user_id: userId,
      created_at: toISOString(config.createdAt),
    })))

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
 * Decrypts sensitive fields after loading
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

    const password = getMasterPassword()

    const configs = await Promise.all(data.map(async (row) => ({
      id: row.id,
      name: row.name,
      apiKey: await decryptText(row.api_key, password),
      apiBase: await decryptText(row.api_base, password),
      model: row.model,
      isDefault: row.is_default,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
    })))

    return configs
  } catch (error) {
    console.error('[DB] Error loading API configs:', error)
    // 如果解密失败，返回空数组而不是抛出错误
    // 这样应用可以继续运行
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

/**
 * 检查是否有设置主密码
 */
export function hasMasterPassword(): boolean {
  return masterPassword !== null
}