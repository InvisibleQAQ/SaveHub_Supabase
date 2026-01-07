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
import {
  setAuthFailureCallback,
  setTokenExpiry,
  clearTokenExpiry,
  proactiveRefresh,
  forceRefresh,
} from "@/lib/api/fetch-client"

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

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Set auth failure callback for fetch-client
  useEffect(() => {
    setAuthFailureCallback(() => {
      setUser(null)
      router.push("/login")
    })
  }, [router])

  // Check session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await authApi.getSession()
        if (session.authenticated && session.user) {
          setUser(session.user)
          // Initialize token expiry on successful session check
          setTokenExpiry(3600)
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

  // Proactive refresh: check every 5 minutes
  useEffect(() => {
    if (!user) return

    const refreshInterval = setInterval(async () => {
      const success = await proactiveRefresh()
      if (!success) {
        // Token refresh failed, clear user state
        setUser(null)
        router.push("/login")
      }
    }, 5 * 60 * 1000) // 5 minutes

    return () => clearInterval(refreshInterval)
  }, [user, router])

  const login = useCallback(async (email: string, password: string) => {
    const authUser = await authApi.login(email, password)
    setUser(authUser)
    setTokenExpiry(3600) // Set token expiry after login
    router.push("/all")
    router.refresh()
  }, [router])

  const register = useCallback(async (email: string, password: string) => {
    const authUser = await authApi.register(email, password)
    setUser(authUser)
    setTokenExpiry(3600) // Set token expiry after register
    router.push("/all")
    router.refresh()
  }, [router])

  const logout = useCallback(async () => {
    await authApi.logout()
    setUser(null)
    clearTokenExpiry() // Clear token expiry on logout
    router.push("/login")
    router.refresh()
  }, [router])

  const refreshSession = useCallback(async () => {
    // Use forceRefresh from fetch-client to ensure mutex protection
    // This prevents race conditions with concurrent refresh attempts
    const success = await forceRefresh()
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
