/**
 * Articles API client for FastAPI backend.
 * Uses HttpOnly cookies for authentication.
 */

import type { Article, Repository } from "../types"

const API_BASE = "/api/backend/articles"

export interface ApiError {
  detail: string
}

export interface ArticleCreateResponse {
  success: boolean
  count: number
}

export interface ArticleUpdateResponse {
  success: boolean
  message?: string
}

export interface ClearOldArticlesResponse {
  deletedCount: number
}

export interface ArticleStats {
  total: number
  unread: number
  starred: number
  byFeed: Record<string, { total: number; unread: number }>
}

/**
 * Transform backend snake_case article to frontend camelCase.
 */
function transformArticle(raw: Record<string, unknown>): Article {
  return {
    id: raw.id as string,
    feedId: raw.feed_id as string,
    title: raw.title as string,
    content: raw.content as string,
    summary: raw.summary as string | undefined,
    url: raw.url as string,
    author: raw.author as string | undefined,
    publishedAt: new Date(raw.published_at as string),
    isRead: (raw.is_read as boolean) ?? false,
    isStarred: (raw.is_starred as boolean) ?? false,
    thumbnail: raw.thumbnail as string | undefined,
    contentHash: raw.content_hash as string | undefined,
    repositoryCount: (raw.repository_count as number) ?? 0,
  }
}

/**
 * Transform frontend camelCase article to backend snake_case.
 */
function toApiFormat(article: Partial<Article>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (article.id !== undefined) result.id = article.id
  if (article.feedId !== undefined) result.feed_id = article.feedId
  if (article.title !== undefined) result.title = article.title
  if (article.content !== undefined) result.content = article.content
  if (article.summary !== undefined) result.summary = article.summary
  if (article.url !== undefined) result.url = article.url
  if (article.author !== undefined) result.author = article.author
  if (article.publishedAt !== undefined) {
    result.published_at = article.publishedAt instanceof Date
      ? article.publishedAt.toISOString()
      : article.publishedAt
  }
  if (article.isRead !== undefined) result.is_read = article.isRead
  if (article.isStarred !== undefined) result.is_starred = article.isStarred
  if (article.thumbnail !== undefined) result.thumbnail = article.thumbnail
  if (article.contentHash !== undefined) result.content_hash = article.contentHash

  return result
}

/**
 * Transform backend snake_case repository to frontend camelCase.
 */
function transformRepository(raw: Record<string, unknown>): Repository {
  return {
    id: raw.id as string,
    githubId: raw.github_id as number,
    name: raw.name as string,
    fullName: raw.full_name as string,
    description: raw.description as string | null,
    htmlUrl: raw.html_url as string,
    stargazersCount: raw.stargazers_count as number,
    language: raw.language as string | null,
    topics: (raw.topics as string[]) || [],
    ownerLogin: raw.owner_login as string,
    ownerAvatarUrl: raw.owner_avatar_url as string | null,
    starredAt: raw.starred_at as string | null,
    githubUpdatedAt: raw.github_updated_at as string | null,
    githubPushedAt: raw.github_pushed_at as string | null,
    readmeContent: raw.readme_content as string | null,
    aiSummary: raw.ai_summary as string | null,
    aiTags: (raw.ai_tags as string[]) || [],
    aiPlatforms: (raw.ai_platforms as string[]) || [],
    analyzedAt: raw.analyzed_at as string | null,
    analysisFailed: (raw.analysis_failed as boolean) || false,
    customDescription: raw.custom_description as string | null,
    customTags: (raw.custom_tags as string[]) || [],
    customCategory: raw.custom_category as string | null,
    lastEdited: raw.last_edited as string | null,
  }
}

/**
 * Get articles for the authenticated user.
 * Supports filtering by feed_id and limiting results.
 */
export async function getArticles(options?: {
  feedId?: string
  limit?: number
}): Promise<Article[]> {
  const params = new URLSearchParams()
  if (options?.feedId) params.set("feed_id", options.feedId)
  if (options?.limit) params.set("limit", String(options.limit))

  const url = params.toString() ? `${API_BASE}?${params}` : API_BASE

  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get articles")
  }

  const data = await response.json()
  return data.map(transformArticle)
}

/**
 * Create or upsert multiple articles.
 */
export async function saveArticles(articles: Partial<Article>[]): Promise<ArticleCreateResponse> {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(articles.map(toApiFormat)),
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to save articles")
  }

  return response.json()
}

/**
 * Get a single article by ID.
 */
export async function getArticle(articleId: string): Promise<Article> {
  const response = await fetch(`${API_BASE}/${articleId}`, {
    method: "GET",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get article")
  }

  const data = await response.json()
  return transformArticle(data)
}

/**
 * Update an article by ID.
 * Supports partial updates - only provided fields will be updated.
 * Primary use case: updating is_read and is_starred status.
 */
export async function updateArticle(
  articleId: string,
  updates: Partial<Pick<Article, "isRead" | "isStarred">>
): Promise<ArticleUpdateResponse> {
  const apiUpdates: Record<string, unknown> = {}
  if (updates.isRead !== undefined) apiUpdates.is_read = updates.isRead
  if (updates.isStarred !== undefined) apiUpdates.is_starred = updates.isStarred

  const response = await fetch(`${API_BASE}/${articleId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(apiUpdates),
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to update article")
  }

  return response.json()
}

/**
 * Clear old read articles that are not starred.
 */
export async function clearOldArticles(days: number = 30): Promise<ClearOldArticlesResponse> {
  const response = await fetch(`${API_BASE}/old?days=${days}`, {
    method: "DELETE",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to clear old articles")
  }

  const data = await response.json()
  return {
    deletedCount: data.deleted_count,
  }
}

/**
 * Get article statistics for the authenticated user.
 */
export async function getArticleStats(): Promise<ArticleStats> {
  const response = await fetch(`${API_BASE}/stats`, {
    method: "GET",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get article stats")
  }

  const data = await response.json()
  return {
    total: data.total,
    unread: data.unread,
    starred: data.starred,
    byFeed: data.by_feed,
  }
}

/**
 * Get repositories linked to an article.
 * Returns repositories extracted from the article content.
 */
export async function getArticleRepositories(articleId: string): Promise<Repository[]> {
  const response = await fetch(`${API_BASE}/${articleId}/repositories`, {
    method: "GET",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get article repositories")
  }

  const data = await response.json()
  return data.map(transformRepository)
}

/**
 * Articles API namespace for easy import.
 */
export const articlesApi = {
  getArticles,
  saveArticles,
  getArticle,
  updateArticle,
  clearOldArticles,
  getArticleStats,
  getArticleRepositories,
}
