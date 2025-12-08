/**
 * Articles API client for FastAPI backend.
 * Uses HttpOnly cookies for authentication.
 */

import type { Article } from "../types"

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
 * Articles API namespace for easy import.
 */
export const articlesApi = {
  getArticles,
  saveArticles,
  getArticle,
  updateArticle,
  clearOldArticles,
  getArticleStats,
}
