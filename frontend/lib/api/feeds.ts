/**
 * Feeds API client for FastAPI backend.
 * Uses HttpOnly cookies for authentication.
 */

import type { Feed } from "../types"

const API_BASE = "/api/backend/feeds"

export interface ApiError {
  detail: string
}

export interface FeedDeleteResponse {
  articles_deleted: number
  feed_deleted: boolean
}

export interface FeedCreateResponse {
  success: boolean
  count: number
}

export interface FeedUpdateResponse {
  success: boolean
  message?: string
}

/**
 * Transform backend snake_case feed to frontend camelCase.
 */
function transformFeed(raw: Record<string, unknown>): Feed {
  return {
    id: raw.id as string,
    title: raw.title as string,
    url: raw.url as string,
    description: raw.description as string | undefined,
    category: raw.category as string | undefined,
    folderId: raw.folder_id as string | undefined,
    order: (raw.order as number) ?? 0,
    unreadCount: (raw.unread_count as number) ?? 0,
    lastFetched: raw.last_fetched ? new Date(raw.last_fetched as string) : undefined,
    refreshInterval: (raw.refresh_interval as number) ?? 60,
    lastFetchStatus: raw.last_fetch_status as "success" | "failed" | null | undefined,
    lastFetchError: raw.last_fetch_error as string | null | undefined,
    enableDeduplication: (raw.enable_deduplication as boolean) ?? false,
  }
}

/**
 * Transform frontend camelCase feed to backend snake_case.
 */
function toApiFormat(feed: Partial<Feed>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (feed.id !== undefined) result.id = feed.id
  if (feed.title !== undefined) result.title = feed.title
  if (feed.url !== undefined) result.url = feed.url
  if (feed.description !== undefined) result.description = feed.description
  if (feed.category !== undefined) result.category = feed.category
  if (feed.folderId !== undefined) result.folder_id = feed.folderId
  if (feed.order !== undefined) result.order = feed.order
  if (feed.unreadCount !== undefined) result.unread_count = feed.unreadCount
  if (feed.lastFetched !== undefined) {
    result.last_fetched = feed.lastFetched instanceof Date
      ? feed.lastFetched.toISOString()
      : feed.lastFetched
  }
  if (feed.refreshInterval !== undefined) result.refresh_interval = feed.refreshInterval
  if (feed.lastFetchStatus !== undefined) result.last_fetch_status = feed.lastFetchStatus
  if (feed.lastFetchError !== undefined) result.last_fetch_error = feed.lastFetchError
  if (feed.enableDeduplication !== undefined) result.enable_deduplication = feed.enableDeduplication

  return result
}

/**
 * Get all feeds for the authenticated user.
 */
export async function getFeeds(): Promise<Feed[]> {
  const response = await fetch(API_BASE, {
    method: "GET",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get feeds")
  }

  const data = await response.json()
  return data.map(transformFeed)
}

/**
 * Create or upsert multiple feeds.
 */
export async function saveFeeds(feeds: Partial<Feed>[]): Promise<FeedCreateResponse> {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(feeds.map(toApiFormat)),
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    if (response.status === 409) {
      throw new Error("duplicate")
    }
    throw new Error(error.detail || "Failed to save feeds")
  }

  return response.json()
}

/**
 * Get a single feed by ID.
 */
export async function getFeed(feedId: string): Promise<Feed> {
  const response = await fetch(`${API_BASE}/${feedId}`, {
    method: "GET",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get feed")
  }

  const data = await response.json()
  return transformFeed(data)
}

/**
 * Update a feed by ID.
 * Supports partial updates - only provided fields will be updated.
 */
export async function updateFeed(
  feedId: string,
  updates: Partial<Feed>
): Promise<FeedUpdateResponse> {
  const response = await fetch(`${API_BASE}/${feedId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(toApiFormat(updates)),
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    if (response.status === 409) {
      throw new Error("duplicate")
    }
    throw new Error(error.detail || "Failed to update feed")
  }

  return response.json()
}

/**
 * Delete a feed and all its articles.
 */
export async function deleteFeed(feedId: string): Promise<{ articlesDeleted: number }> {
  const response = await fetch(`${API_BASE}/${feedId}`, {
    method: "DELETE",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to delete feed")
  }

  const data: FeedDeleteResponse = await response.json()
  return {
    articlesDeleted: data.articles_deleted,
  }
}

/**
 * Feeds API namespace for easy import.
 */
export const feedsApi = {
  getFeeds,
  saveFeeds,
  getFeed,
  updateFeed,
  deleteFeed,
}
