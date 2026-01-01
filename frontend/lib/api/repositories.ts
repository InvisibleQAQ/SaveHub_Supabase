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

  /**
   * Update repository custom fields
   */
  async update(
    id: string,
    data: {
      customDescription?: string | null
      customTags?: string[]
      customCategory?: string | null
    }
  ): Promise<Repository> {
    const response = await fetch(`${API_BASE}/api/repositories/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_description: data.customDescription,
        custom_tags: data.customTags,
        custom_category: data.customCategory,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Update failed: ${response.status}`)
    }

    const result = await response.json()
    return mapResponseToRepository(result)
  },

  /**
   * Analyze repository with AI
   */
  async analyze(id: string): Promise<Repository> {
    const response = await fetch(`${API_BASE}/api/repositories/${id}/analyze`, {
      method: "POST",
      credentials: "include",
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Analysis failed: ${response.status}`)
    }

    const result = await response.json()
    return mapResponseToRepository(result)
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
    // AI analysis fields
    aiSummary: data.ai_summary as string | null,
    aiTags: (data.ai_tags as string[]) || [],
    aiPlatforms: (data.ai_platforms as string[]) || [],
    analyzedAt: data.analyzed_at as string | null,
    analysisFailed: (data.analysis_failed as boolean) || false,
    // Custom edit fields
    customDescription: data.custom_description as string | null,
    customTags: (data.custom_tags as string[]) || [],
    customCategory: data.custom_category as string | null,
    lastEdited: data.last_edited as string | null,
  }
}
