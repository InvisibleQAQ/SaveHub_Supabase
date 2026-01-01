/**
 * Repositories API client
 */

import { Repository, SyncResult } from "@/lib/types"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export const repositoriesApi = {
  /**
   * Get all repositories for current user
   */
  async getAll(): Promise<Repository[]> {
    const response = await fetch(`${API_BASE}/api/repositories`, {
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch repositories: ${response.status}`)
    }

    const data = await response.json()
    return data.map(mapResponseToRepository)
  },

  /**
   * Sync repositories from GitHub
   */
  async sync(): Promise<SyncResult> {
    const response = await fetch(`${API_BASE}/api/repositories/sync`, {
      method: "POST",
      credentials: "include",
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Sync failed: ${response.status}`)
    }

    const data = await response.json()
    return {
      total: data.total,
      newCount: data.new_count,
      updatedCount: data.updated_count,
    }
  },
}

// Map snake_case API response to camelCase
function mapResponseToRepository(data: Record<string, unknown>): Repository {
  return {
    id: data.id as string,
    githubId: data.github_id as number,
    name: data.name as string,
    fullName: data.full_name as string,
    description: data.description as string | null,
    htmlUrl: data.html_url as string,
    stargazersCount: data.stargazers_count as number,
    language: data.language as string | null,
    topics: (data.topics as string[]) || [],
    ownerLogin: data.owner_login as string,
    ownerAvatarUrl: data.owner_avatar_url as string | null,
    starredAt: data.starred_at as string | null,
    githubUpdatedAt: data.github_updated_at as string | null,
    readmeContent: data.readme_content as string | null,
  }
}
