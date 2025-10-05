import { createClient } from "../supabase/client"

/**
 * Get current authenticated user ID
 * Throws if not authenticated
 */
export async function getCurrentUserId(): Promise<string> {
  const supabase = createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    throw new Error('Not authenticated')
  }
  return user.id
}

/**
 * Safely converts a Date object or date string to ISO string format
 * Handles both Date objects and already-stringified dates from JSON serialization
 */
export function toISOString(date: Date | string | undefined | null): string | null {
  if (!date) return null
  if (typeof date === "string") return date
  if (date instanceof Date) return date.toISOString()
  return null
}

/**
 * Check if database tables are properly initialized
 * Returns true if all required tables exist with correct schema
 */
export async function isDatabaseInitialized(): Promise<boolean> {
  try {
    const supabase = createClient()

    // Check if all tables exist with user_id columns
    // This bypasses RLS by just checking table structure
    const tables = ['folders', 'feeds', 'articles', 'api_configs']

    for (const table of tables) {
      const { error } = await supabase.from(table).select("user_id").limit(0)

      if (error) {
        // Check for specific "table does not exist" or "column does not exist" errors
        if (
          error.message?.includes("does not exist") ||
          error.message?.includes("schema cache") ||
          error.code === "42703" || // Column does not exist
          error.code === "42P01"    // Table does not exist
        ) {
          return false
        }

        // For RLS errors (user not authenticated), table exists but continue checking others
        if (!(error.code === "PGRST301" || error.message?.includes("row-level security"))) {
          return false
        }
      }
    }

    // Check settings table (has different structure)
    const { error: settingsError } = await supabase.from("settings").select("user_id").limit(0)
    if (settingsError) {
      if (
        settingsError.message?.includes("does not exist") ||
        settingsError.message?.includes("schema cache") ||
        settingsError.code === "42703" || // Column does not exist
        settingsError.code === "42P01"    // Table does not exist
      ) {
        return false
      }
    }

    return true
  } catch (error) {
    console.error("Error checking database initialization:", error)
    return false
  }
}