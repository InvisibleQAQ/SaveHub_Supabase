/**
 * GitHub API client for token validation.
 * Uses HttpOnly cookies for authentication.
 */

const API_BASE = "/api/backend/github"

export interface ValidateTokenResponse {
  valid: boolean
  username?: string
  error?: string
}

export interface ApiError {
  detail: string
}

/**
 * Validate a GitHub Personal Access Token.
 * Calls backend endpoint which proxies to GitHub API.
 */
export async function validateGitHubToken(token: string): Promise<ValidateTokenResponse> {
  const response = await fetch(`${API_BASE}/validate-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ token }),
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to validate token")
  }

  return response.json()
}

/**
 * GitHub API namespace for easy import.
 */
export const githubApi = {
  validateGitHubToken,
}
