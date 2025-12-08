"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { authApi, type AuthUser } from "@/lib/api/auth"
import { supabase } from "@/lib/supabase/client"

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Initialize Supabase SDK session with tokens from backend.
 * This allows frontend Supabase queries to work with RLS.
 */
async function setSupabaseSession(accessToken?: string, refreshToken?: string) {
  if (!accessToken || !refreshToken) {
    return
  }
  try {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
  } catch (error) {
    console.error("[Auth] Failed to set Supabase session:", error)
  }
}

/**
 * Clear Supabase SDK session on logout.
 */
async function clearSupabaseSession() {
  try {
    await supabase.auth.signOut()
  } catch (error) {
    console.error("[Auth] Failed to clear Supabase session:", error)
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Check session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await authApi.getSession()
        if (session.authenticated && session.user) {
          setUser(session.user)
          // Initialize Supabase SDK session for RLS
          await setSupabaseSession(session.accessToken, session.refreshToken)
        } else {
          setUser(null)
        }
      } catch {
        setUser(null)
      } finally {
        setIsLoading(false)
      }
    }

    checkSession()
  }, [])

  // Refresh token periodically (every 10 minutes)
  useEffect(() => {
    if (!user) return

    const refreshInterval = setInterval(async () => {
      const success = await authApi.refreshToken()
      if (!success) {
        // Token refresh failed, clear user state
        setUser(null)
        router.push("/login")
      }
    }, 10 * 60 * 1000) // 10 minutes

    return () => clearInterval(refreshInterval)
  }, [user, router])

  const login = useCallback(async (email: string, password: string) => {
    const authUser = await authApi.login(email, password)
    // Initialize Supabase SDK session for RLS
    await setSupabaseSession(authUser.accessToken, authUser.refreshToken)
    setUser(authUser)
    router.push("/all")
    router.refresh()
  }, [router])

  const register = useCallback(async (email: string, password: string) => {
    const authUser = await authApi.register(email, password)
    // Initialize Supabase SDK session for RLS
    await setSupabaseSession(authUser.accessToken, authUser.refreshToken)
    setUser(authUser)
    router.push("/all")
    router.refresh()
  }, [router])

  const logout = useCallback(async () => {
    await authApi.logout()
    // Clear Supabase SDK session
    await clearSupabaseSession()
    setUser(null)
    router.push("/login")
    router.refresh()
  }, [router])

  const refreshSession = useCallback(async () => {
    const success = await authApi.refreshToken()
    if (!success) {
      setUser(null)
    }
    return success
  }, [])

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshSession,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
