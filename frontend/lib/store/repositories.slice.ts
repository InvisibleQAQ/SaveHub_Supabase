/**
 * Repositories Zustand slice
 */

import type { StateCreator } from "zustand"
import type { Repository, SyncResult } from "../types"
import { repositoriesApi } from "../api/repositories"

export interface SyncProgress {
  phase: "fetching" | "fetched" | "analyzing" | "saving" | "openrank" | "embedding"
  total?: number
  current?: string
  completed?: number
  // Saving phase fields
  savedCount?: number
  saveTotal?: number
}

export interface RepositoriesSlice {
  repositories: Repository[]
  isSyncing: boolean
  isAnalyzing: boolean
  syncProgress: SyncProgress | null
  lastSyncedAt: string | null
  loadRepositories: () => Promise<void>
  syncRepositories: () => Promise<SyncResult>
  setSyncProgress: (progress: SyncProgress | null) => void
  setRepositories: (repos: Repository[]) => void
  updateRepository: (
    id: string,
    data: {
      customDescription?: string | null
      customTags?: string[]
      customCategory?: string | null
    }
  ) => Promise<Repository>
  analyzeRepository: (id: string) => Promise<Repository>
}

export const createRepositoriesSlice: StateCreator<
  RepositoriesSlice,
  [],
  [],
  RepositoriesSlice
> = (set, get) => ({
  repositories: [],
  isSyncing: false,
  isAnalyzing: false,
  syncProgress: null,
  lastSyncedAt: null,

  loadRepositories: async () => {
    const repos = await repositoriesApi.getAll()
    set({ repositories: repos })
  },

  syncRepositories: async () => {
    set({ isSyncing: true, syncProgress: null })
    try {
      const result = await repositoriesApi.syncWithProgress((progress) => {
        set({ syncProgress: progress })
      })
      const repos = await repositoriesApi.getAll()
      set({
        repositories: repos,
        lastSyncedAt: new Date().toISOString(),
      })
      return result
    } finally {
      set({ isSyncing: false, syncProgress: null })
    }
  },

  setSyncProgress: (progress) => {
    set({ syncProgress: progress })
  },

  setRepositories: (repos: Repository[]) => {
    set({ repositories: repos })
  },

  updateRepository: async (id, data) => {
    const updated = await repositoriesApi.update(id, data)
    set((state) => ({
      repositories: state.repositories.map((repo) =>
        repo.id === id ? updated : repo
      ),
    }))
    return updated
  },

  analyzeRepository: async (id) => {
    set({ isAnalyzing: true })
    try {
      const updated = await repositoriesApi.analyze(id)
      set((state) => ({
        repositories: state.repositories.map((repo) =>
          repo.id === id ? updated : repo
        ),
      }))
      return updated
    } finally {
      set({ isAnalyzing: false })
    }
  },
})
