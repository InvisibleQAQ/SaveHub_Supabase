/**
 * Feeds API client for FastAPI backend.
 * Uses HttpOnly cookies for authentication.
 */

import type { Feed } from "../types"
import { fetchWithAuth } from "./fetch-client"

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
 * Includes strict type checking to prevent circular reference errors from DOM elements.
 */
function toApiFormat(feed: Partial<Feed>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // Helper functions for strict type checking
  const isString = (val: unknown): val is string => typeof val === "string"
  const isNumber = (val: unknown): val is number => typeof val === "number" && !Number.isNaN(val)
  const isBoolean = (val: unknown): val is boolean => typeof val === "boolean"
  const isDate = (val: unknown): val is Date => val instanceof Date && !Number.isNaN(val.getTime())
  const isValidStatus = (val: unknown): val is "success" | "failed" | null =>
    val === "success" || val === "failed" || val === null

  // Only include fields with correct primitive types
  if (isString(feed.id)) result.id = feed.id
  if (isString(feed.title)) result.title = feed.title
  if (isString(feed.url)) result.url = feed.url
  if (isString(feed.description)) result.description = feed.description
  if (isString(feed.category)) result.category = feed.category
  if (isString(feed.folderId)) result.folder_id = feed.folderId
  if (isNumber(feed.order)) result.order = feed.order
  if (isNumber(feed.unreadCount)) result.unread_count = feed.unreadCount
  if (isDate(feed.lastFetched)) {
    result.last_fetched = feed.lastFetched.toISOString()
  } else if (isString(feed.lastFetched)) {
    result.last_fetched = feed.lastFetched
  }
  if (isNumber(feed.refreshInterval)) result.refresh_interval = feed.refreshInterval
  if (isValidStatus(feed.lastFetchStatus)) result.last_fetch_status = feed.lastFetchStatus
  if (isString(feed.lastFetchError) || feed.lastFetchError === null) {
    result.last_fetch_error = feed.lastFetchError
  }
  if (isBoolean(feed.enableDeduplication)) result.enable_deduplication = feed.enableDeduplication

  return result
}

/**
 * Get all feeds for the authenticated user.
 */
export async function getFeeds(): Promise<Feed[]> {
  const response = await fetchWithAuth(API_BASE, {
    method: "GET",
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
  const response = await fetchWithAuth(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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
  const response = await fetchWithAuth(`${API_BASE}/${feedId}`, {
    method: "GET",
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
  const response = await fetchWithAuth(`${API_BASE}/${feedId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
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
  const response = await fetchWithAuth(`${API_BASE}/${feedId}`, {
    method: "DELETE",
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
