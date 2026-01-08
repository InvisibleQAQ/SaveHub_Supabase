/**
 * Auth API client for FastAPI backend.
 * Uses HttpOnly cookies for token management.
 */

const API_BASE = "/api/backend/auth"

export interface AuthUser {
  userId: string
  email: string
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
}

export interface SessionResponse {
  authenticated: boolean
  user?: AuthUser
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
}

export interface AuthError {
  detail: string
}

/**
 * Login with email and password.
 * Backend sets HttpOnly cookies automatically.
 */
export async function login(email: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include", // Important: include cookies
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    const error: AuthError = await response.json()
    throw new Error(error.detail || "Login failed")
  }

  const data = await response.json()
  return {
    userId: data.user_id,
    email: data.email,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

/**
 * Register a new user with email and password.
 * Backend sets HttpOnly cookies automatically.
 * Returns tokens for Supabase SDK initialization.
 */
export async function register(email: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${API_BASE}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    const error: AuthError = await response.json()
    throw new Error(error.detail || "Registration failed")
  }

  const data = await response.json()
  return {
    userId: data.user_id,
    email: data.email,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  }
}

/**
 * Logout and clear authentication cookies.
 */
export async function logout(): Promise<void> {
  const response = await fetch(`${API_BASE}/logout`, {
    method: "POST",
    credentials: "include",
  })

  if (!response.ok) {
    const error: AuthError = await response.json()
    throw new Error(error.detail || "Logout failed")
  }
}

/**
 * Check current session status.
 * Returns user info and tokens for Supabase SDK initialization.
 */
export async function getSession(): Promise<SessionResponse> {
  try {
    const response = await fetch(`${API_BASE}/session`, {
      method: "GET",
      credentials: "include",
    })

    if (!response.ok) {
      return { authenticated: false }
    }

    const data = await response.json()

    if (!data.authenticated) {
      return { authenticated: false }
    }

    return {
      authenticated: true,
      user: {
        userId: data.user_id,
        email: data.email,
      },
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    }
  } catch {
    return { authenticated: false }
  }
}

/**
 * Refresh the access token using the refresh token cookie.
 * Returns true if successful.
 */
export async function refreshToken(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/refresh`, {
      method: "POST",
      credentials: "include",
    })

    return response.ok
  } catch {
    return false
  }
}

/**
 * Auth API namespace for easy import.
 */
export const authApi = {
  login,
  register,
  logout,
  getSession,
  refreshToken,
}
