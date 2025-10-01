import { createBrowserClient } from "@supabase/ssr"

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('[Supabase Client] Missing environment variables:', {
      url: supabaseUrl ? 'SET' : 'MISSING',
      key: supabaseKey ? 'SET' : 'MISSING'
    })
    throw new Error('Missing Supabase environment variables. Check .env file.')
  }

  console.log('[Supabase Client] Initializing with URL:', supabaseUrl)
  return createBrowserClient(supabaseUrl, supabaseKey)
}
