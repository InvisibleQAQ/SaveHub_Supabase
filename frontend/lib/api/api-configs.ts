/**
 * API Configs HTTP Client for FastAPI backend.
 * Uses HttpOnly cookies for authentication.
 */

import type { ApiConfig } from "../types"

const API_BASE = "/api/backend/api-configs"

export interface ApiError {
  detail: string
}

export interface ApiConfigDeleteResponse {
  success: boolean
}

export interface SetDefaultResponse {
  success: boolean
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
  is_default: boolean
  is_active: boolean
  created_at: string
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
    isDefault: raw.is_default,
    isActive: raw.is_active,
    createdAt: new Date(raw.created_at),
  }
}

/**
 * Transform frontend camelCase ApiConfig to backend snake_case format.
 * Includes strict type checking to prevent serialization errors.
 */
function toApiFormat(config: Partial<ApiConfig>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  const isString = (val: unknown): val is string => typeof val === "string"
  const isBoolean = (val: unknown): val is boolean => typeof val === "boolean"

  if (isString(config.name)) result.name = config.name
  if (isString(config.apiKey)) result.api_key = config.apiKey
  if (isString(config.apiBase)) result.api_base = config.apiBase
  if (isString(config.model)) result.model = config.model
  if (isBoolean(config.isDefault)) result.is_default = config.isDefault
  if (isBoolean(config.isActive)) result.is_active = config.isActive

  return result
}

/**
 * Get all API configs for the authenticated user.
 */
export async function getApiConfigs(): Promise<ApiConfig[]> {
  const response = await fetch(API_BASE, {
    method: "GET",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get API configs")
  }

  const data: ApiConfigResponse[] = await response.json()
  return data.map(transformApiConfig)
}

/**
 * Create a new API config.
 */
export async function createApiConfig(
  config: Omit<ApiConfig, "id" | "createdAt">
): Promise<ApiConfig> {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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
 * Supports partial updates - only provided fields will be updated.
 */
export async function updateApiConfig(
  id: string,
  updates: Partial<ApiConfig>
): Promise<ApiConfig> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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
  const response = await fetch(`${API_BASE}/${id}`, {
    method: "DELETE",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to delete API config")
  }
}

/**
 * Set an API config as the default.
 * Unsets any previously default config for this user.
 */
export async function setDefaultConfig(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}/set-default`, {
    method: "POST",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to set default config")
  }
}

/**
 * API Configs API namespace for easy import.
 */
export const apiConfigsApi = {
  getApiConfigs,
  createApiConfig,
  updateApiConfig,
  deleteApiConfig,
  setDefaultConfig,
}
