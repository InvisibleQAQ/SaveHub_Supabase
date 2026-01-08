/**
 * Unified fetch client with automatic token refresh.
 *
 * Features:
 * - Automatic 401 detection and token refresh
 * - Request retry after successful refresh
 * - Concurrent request handling (single refresh via mutex)
 * - Silent redirect to /login on refresh failure
 * - Proactive refresh before token expiry
 */

// ============================================================================
// Types
// ============================================================================

interface RefreshState {
  /** Whether a refresh is currently in progress */
  isRefreshing: boolean
  /** Promise that resolves when refresh completes */
  refreshPromise: Promise<boolean> | null
}

// ============================================================================
// State
// ============================================================================

/** URLs that should skip auth refresh (login, register, refresh itself) */
const SKIP_AUTH_URLS = [
  "/api/backend/auth/login",
  "/api/backend/auth/register",
  "/api/backend/auth/refresh",
  "/api/backend/auth/logout",
  "/api/backend/auth/session",
]

/** Callback when refresh fails - redirect to login */
let onAuthFailure: () => void = () => {
  if (typeof window !== "undefined") {
    window.location.href = "/login"
  }
}

/** Refresh state with mutex lock */
const refreshState: RefreshState = {
  isRefreshing: false,
  refreshPromise: null,
}

/** Token expiry timestamp (milliseconds since epoch) */
let tokenExpiresAt: number | null = null

/** Buffer time before expiry to trigger proactive refresh (5 minutes) */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

/** Default token validity (1 hour, Supabase default) */
const DEFAULT_TOKEN_VALIDITY_SECONDS = 3600

// ============================================================================
// Configuration Functions
// ============================================================================

/**
 * Set the auth failure callback (called by AuthProvider).
 * This allows the auth context to handle logout and navigation.
 */
export function setAuthFailureCallback(callback: () => void): void {
  onAuthFailure = callback
}

/**
 * Update token expiry time (called after login/refresh).
 * @param expiresInSeconds - Token validity in seconds (default: 3600 for Supabase)
 */
export function setTokenExpiry(
  expiresInSeconds: number = DEFAULT_TOKEN_VALIDITY_SECONDS
): void {
  tokenExpiresAt = Date.now() + expiresInSeconds * 1000
}

/**
 * Clear token expiry (called on logout).
 */
export function clearTokenExpiry(): void {
  tokenExpiresAt = null
}

// ============================================================================
// Token Expiry Checks
// ============================================================================

/**
 * Check if token is about to expire (within buffer time).
 * Returns false if no expiry is set (conservative approach).
 */
export function isTokenExpiringSoon(): boolean {
  if (!tokenExpiresAt) return false
  return Date.now() > tokenExpiresAt - EXPIRY_BUFFER_MS
}

/**
 * Check if URL should skip auth handling.
 */
function shouldSkipAuth(url: string): boolean {
  return SKIP_AUTH_URLS.some((skipUrl) => url.includes(skipUrl))
}

// ============================================================================
// Refresh Logic
// ============================================================================

/**
 * Perform token refresh with mutex lock.
 * Ensures only one refresh happens at a time, even with concurrent requests.
 */
async function doRefresh(): Promise<boolean> {
  // If already refreshing, wait for that to complete
  if (refreshState.isRefreshing && refreshState.refreshPromise) {
    return refreshState.refreshPromise
  }

  refreshState.isRefreshing = true
  refreshState.refreshPromise = (async () => {
    try {
      const response = await fetch("/api/backend/auth/refresh", {
        method: "POST",
        credentials: "include",
      })

      if (response.ok) {
        // Read expires_in from server response, fallback to default
        const data = await response.json()
        const expiresIn = data.expires_in || DEFAULT_TOKEN_VALIDITY_SECONDS
        setTokenExpiry(expiresIn)
        return true
      }
      return false
    } catch {
      return false
    } finally {
      refreshState.isRefreshing = false
      refreshState.refreshPromise = null
    }
  })()

  return refreshState.refreshPromise
}

/**
 * Proactive refresh scheduler.
 * Call this periodically to refresh token before expiry.
 * Returns true if token is valid (either not expiring or refresh succeeded).
 */
export async function proactiveRefresh(): Promise<boolean> {
  if (isTokenExpiringSoon()) {
    return doRefresh()
  }
  return true
}

/**
 * Force refresh the token.
 * Uses the same mutex as all other refresh operations to prevent race conditions.
 * This is the ONLY function that should be used to refresh tokens from outside this module.
 */
export async function forceRefresh(): Promise<boolean> {
  return doRefresh()
}

// ============================================================================
// Main Fetch Function
// ============================================================================

/**
 * Fetch with automatic token refresh.
 *
 * @param input - URL or Request object
 * @param init - Fetch options (credentials: "include" is added automatically)
 * @returns Response
 *
 * Behavior:
 * 1. If token is expiring soon, proactively refresh before request
 * 2. If request returns 401, refresh token and retry once
 * 3. If refresh fails, call onAuthFailure (redirect to login)
 *
 * @throws Error with message "Session expired" if refresh fails
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // Extract URL string for checking
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url

  // Skip auth handling for auth endpoints (prevent refresh loops)
  if (shouldSkipAuth(url)) {
    return fetch(input, {
      ...init,
      credentials: "include",
    })
  }

  // Proactive refresh: if token is expiring soon, refresh first
  if (isTokenExpiringSoon()) {
    const refreshed = await doRefresh()
    if (!refreshed) {
      onAuthFailure()
      throw new Error("Session expired")
    }
  }

  // Make the request with credentials
  const response = await fetch(input, {
    ...init,
    credentials: "include",
  })

  // If 401, try to refresh and retry once
  if (response.status === 401) {
    const refreshed = await doRefresh()

    if (refreshed) {
      // Retry the original request
      return fetch(input, {
        ...init,
        credentials: "include",
      })
    } else {
      // Refresh failed, trigger auth failure handler
      onAuthFailure()
      throw new Error("Session expired")
    }
  }

  return response
}
