import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('[Supabase Client] Missing environment variables:', {
    url: supabaseUrl ? 'SET' : 'MISSING',
    key: supabaseKey ? 'SET' : 'MISSING'
  })
  throw new Error('Missing Supabase environment variables. Check .env file.')
}

console.log('[Supabase Client] Initializing singleton instance with URL:', supabaseUrl)

/**
 * Supabase client singleton instance
 * Created once when module is first imported
 * Import this directly instead of calling a factory function
 */
export const supabase = createBrowserClient(supabaseUrl, supabaseKey)

/**
 * Legacy function for backward compatibility
 * @deprecated Use `supabase` export directly instead
 *
 * @example
 * // ❌ Old way (deprecated)
 * import { createClient } from '@/lib/supabase/client'
 * const supabase = createClient()
 *
 * // ✅ New way (recommended)
 * import { supabase } from '@/lib/supabase/client'
 */
export function createClient(): SupabaseClient {
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      '[Supabase] createClient() is deprecated. Use direct supabase import instead.\n' +
      'Replace: import { createClient } from "@/lib/supabase/client"\n' +
      'With:    import { supabase } from "@/lib/supabase/client"'
    )
  }
  return supabase
}
