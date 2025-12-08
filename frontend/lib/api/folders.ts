/**
 * Folders API client for FastAPI backend.
 * Uses HttpOnly cookies for authentication.
 */

import type { Folder } from "../types"

const API_BASE = "/api/backend/folders"

export interface ApiError {
  detail: string
}

export interface FolderCreateResponse {
  success: boolean
  count: number
}

export interface FolderUpdateResponse {
  success: boolean
  message?: string
}

export interface FolderDeleteResponse {
  success: boolean
}

/**
 * Transform backend snake_case folder to frontend camelCase.
 */
function transformFolder(raw: Record<string, unknown>): Folder {
  return {
    id: raw.id as string,
    name: raw.name as string,
    order: (raw.order as number) ?? 0,
    createdAt: raw.created_at ? new Date(raw.created_at as string) : new Date(),
  }
}

/**
 * Transform frontend camelCase folder to backend snake_case.
 */
function toApiFormat(folder: Partial<Folder>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (folder.id !== undefined) result.id = folder.id
  if (folder.name !== undefined) result.name = folder.name
  if (folder.order !== undefined) result.order = folder.order
  if (folder.createdAt !== undefined) {
    result.created_at = folder.createdAt instanceof Date
      ? folder.createdAt.toISOString()
      : folder.createdAt
  }

  return result
}

/**
 * Get all folders for the authenticated user.
 */
export async function getFolders(): Promise<Folder[]> {
  const response = await fetch(API_BASE, {
    method: "GET",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get folders")
  }

  const data = await response.json()
  return data.map(transformFolder)
}

/**
 * Create or upsert multiple folders.
 */
export async function saveFolders(folders: Partial<Folder>[]): Promise<FolderCreateResponse> {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(folders.map(toApiFormat)),
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    if (response.status === 409) {
      throw new Error("duplicate")
    }
    throw new Error(error.detail || "Failed to save folders")
  }

  return response.json()
}

/**
 * Update a folder by ID.
 * Supports partial updates - only provided fields will be updated.
 */
export async function updateFolder(
  folderId: string,
  updates: Partial<Folder>
): Promise<FolderUpdateResponse> {
  const response = await fetch(`${API_BASE}/${folderId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(toApiFormat(updates)),
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to update folder")
  }

  return response.json()
}

/**
 * Delete a folder.
 * Note: Feeds in this folder will have their folder_id set to null.
 */
export async function deleteFolder(folderId: string): Promise<FolderDeleteResponse> {
  const response = await fetch(`${API_BASE}/${folderId}`, {
    method: "DELETE",
    credentials: "include",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to delete folder")
  }

  return response.json()
}

/**
 * Folders API namespace for easy import.
 */
export const foldersApi = {
  getFolders,
  saveFolders,
  updateFolder,
  deleteFolder,
}
