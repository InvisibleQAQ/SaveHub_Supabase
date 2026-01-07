/**
 * API Configs HTTP Client for FastAPI backend.
 *
 * Supports three API types: chat, embedding, rerank.
 * Uses HttpOnly cookies for authentication.
 */

import type { ApiConfig, ApiConfigType, ApiConfigsGrouped } from "../types"
import { fetchWithAuth } from "./fetch-client"

const API_BASE = "/api/backend/api-configs"

export interface ApiError {
  detail: string
}

/**
 * Backend response type (snake_case).
 */
interface ApiConfigResponse {
  id: string
  user_id: string
  name: string
  api_key: string
  api_base: string
  model: string
  type: ApiConfigType
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Backend grouped response type.
 */
interface ApiConfigsGroupedResponse {
  chat: ApiConfigResponse[]
  embedding: ApiConfigResponse[]
  rerank: ApiConfigResponse[]
}

/**
 * Transform backend snake_case response to frontend camelCase ApiConfig.
 */
function transformApiConfig(raw: ApiConfigResponse): ApiConfig {
  return {
    id: raw.id,
    name: raw.name,
    apiKey: raw.api_key,
    apiBase: raw.api_base,
    model: raw.model,
    type: raw.type,
    isActive: raw.is_active,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  }
}

/**
 * Transform frontend camelCase ApiConfig to backend snake_case format.
 */
function toApiFormat(config: Partial<ApiConfig>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  const isString = (val: unknown): val is string => typeof val === "string"
  const isBoolean = (val: unknown): val is boolean => typeof val === "boolean"

  if (isString(config.name)) result.name = config.name
  if (isString(config.apiKey)) result.api_key = config.apiKey
  if (isString(config.apiBase)) result.api_base = config.apiBase
  if (isString(config.model)) result.model = config.model
  if (isString(config.type)) result.type = config.type
  if (isBoolean(config.isActive)) result.is_active = config.isActive

  return result
}

/**
 * Get all API configs, optionally filtered by type.
 */
export async function getApiConfigs(type?: ApiConfigType): Promise<ApiConfig[]> {
  const url = type ? `${API_BASE}?type=${type}` : API_BASE
  const response = await fetchWithAuth(url, {
    method: "GET",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get API configs")
  }

  const data: ApiConfigResponse[] = await response.json()
  return data.map(transformApiConfig)
}

/**
 * Get all API configs grouped by type.
 * Returns: { chat: [...], embedding: [...], rerank: [...] }
 */
export async function getApiConfigsGrouped(): Promise<ApiConfigsGrouped> {
  const response = await fetchWithAuth(`${API_BASE}/grouped`, {
    method: "GET",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get grouped API configs")
  }

  const data: ApiConfigsGroupedResponse = await response.json()
  return {
    chat: data.chat.map(transformApiConfig),
    embedding: data.embedding.map(transformApiConfig),
    rerank: data.rerank.map(transformApiConfig),
  }
}

/**
 * Get the active config for a specific type.
 * Returns null if no active config exists.
 */
export async function getActiveConfig(type: ApiConfigType): Promise<ApiConfig | null> {
  const response = await fetchWithAuth(`${API_BASE}/active/${type}`, {
    method: "GET",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get active config")
  }

  const data: ApiConfigResponse | null = await response.json()
  return data ? transformApiConfig(data) : null
}

/**
 * Create a new API config.
 * If is_active=true, deactivates other configs of same type.
 */
export async function createApiConfig(
  config: Omit<ApiConfig, "id" | "createdAt" | "updatedAt">
): Promise<ApiConfig> {
  const response = await fetchWithAuth(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toApiFormat(config)),
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to create API config")
  }

  const data: ApiConfigResponse = await response.json()
  return transformApiConfig(data)
}

/**
 * Update an API config by ID.
 * If is_active=true, deactivates others of same type.
 */
export async function updateApiConfig(
  id: string,
  updates: Partial<ApiConfig>
): Promise<ApiConfig> {
  const response = await fetchWithAuth(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toApiFormat(updates)),
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to update API config")
  }

  const data: ApiConfigResponse = await response.json()
  return transformApiConfig(data)
}

/**
 * Delete an API config by ID.
 */
export async function deleteApiConfig(id: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE}/${id}`, {
    method: "DELETE",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to delete API config")
  }
}

/**
 * Activate a config, auto-deactivating others of same type.
 */
export async function activateConfig(id: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE}/${id}/activate`, {
    method: "POST",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to activate config")
  }
}

/**
 * API Configs API namespace for easy import.
 */
export const apiConfigsApi = {
  getAll: getApiConfigs,
  getGrouped: getApiConfigsGrouped,
  getActive: getActiveConfig,
  create: createApiConfig,
  update: updateApiConfig,
  delete: deleteApiConfig,
  activate: activateConfig,
}
