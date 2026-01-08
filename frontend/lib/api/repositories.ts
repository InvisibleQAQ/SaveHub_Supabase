/**
 * Repositories API client
 */

import { Repository, SyncResult } from "@/lib/types"
import { fetchWithAuth, isTokenExpiringSoon, proactiveRefresh } from "./fetch-client"

const API_BASE = "/api/backend/repositories"

/** SSE progress event from sync endpoint */
export interface SyncProgressEvent {
  phase: "fetching" | "fetched" | "analyzing" | "saving" | "openrank" | "embedding"
  total?: number
  current?: string
  completed?: number
}

export const repositoriesApi = {
  /**
   * Get all repositories for current user
   */
  async getAll(): Promise<Repository[]> {
    const response = await fetchWithAuth(`${API_BASE}`, {
      method: "GET",
      cache: "no-store",
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch repositories: ${response.status}`)
    }

    const data = await response.json()
    return data.map(mapResponseToRepository)
  },

  /**
   * Sync repositories from GitHub with SSE progress updates
   */
  async syncWithProgress(
    onProgress: (progress: SyncProgressEvent) => void
  ): Promise<SyncResult> {
    // Proactive refresh before SSE long-running request
    if (isTokenExpiringSoon()) {
      const refreshed = await proactiveRefresh()
      if (!refreshed) {
        throw new Error("Session expired")
      }
    }

    const response = await fetchWithAuth(`${API_BASE}/sync`, {
      method: "POST",
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Sync failed: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response body")

    const decoder = new TextDecoder()
    let buffer = ""
    let result: SyncResult | null = null
    let currentEvent = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6))

          if (currentEvent === "progress") {
            onProgress(data as SyncProgressEvent)
          } else if (currentEvent === "done") {
            result = {
              total: data.total,
              newCount: data.new_count,
              updatedCount: data.updated_count,
            }
          } else if (currentEvent === "error") {
            throw new Error(data.message || "Sync failed")
          }
        }
      }
    }

    if (!result) throw new Error("Sync completed without result")
    return result
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
    const response = await fetchWithAuth(`${API_BASE}/${id}`, {
      method: "PATCH",
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
    const response = await fetchWithAuth(`${API_BASE}/${id}/analyze`, {
      method: "POST",
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
    githubPushedAt: data.github_pushed_at as string | null,
    readmeContent: data.readme_content as string | null,
    // AI analysis fields
    aiSummary: data.ai_summary as string | null,
    aiTags: (data.ai_tags as string[]) || [],
    aiPlatforms: (data.ai_platforms as string[]) || [],
    analyzedAt: data.analyzed_at as string | null,
    analysisFailed: (data.analysis_failed as boolean) || false,
    // OpenRank
    openrank: data.openrank as number | null,
    // Custom edit fields
    customDescription: data.custom_description as string | null,
    customTags: (data.custom_tags as string[]) || [],
    customCategory: data.custom_category as string | null,
    lastEdited: data.last_edited as string | null,
  }
}
