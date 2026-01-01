/**
 * Repositories Zustand slice
 */

import type { StateCreator } from "zustand"
import type { Repository, SyncResult } from "../types"
import { repositoriesApi } from "../api/repositories"

export interface RepositoriesSlice {
  repositories: Repository[]
  isSyncing: boolean
  isAnalyzing: boolean
  lastSyncedAt: string | null
  loadRepositories: () => Promise<void>
  syncRepositories: () => Promise<SyncResult>
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
  lastSyncedAt: null,

  loadRepositories: async () => {
    const repos = await repositoriesApi.getAll()
    set({ repositories: repos })
  },

  syncRepositories: async () => {
    set({ isSyncing: true })
    try {
      const result = await repositoriesApi.sync()
      const repos = await repositoriesApi.getAll()
      set({
        repositories: repos,
        lastSyncedAt: new Date().toISOString(),
      })
      return result
    } finally {
      set({ isSyncing: false })
    }
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
