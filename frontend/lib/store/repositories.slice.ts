/**
 * Repositories Zustand slice
 */

import type { StateCreator } from "zustand"
import type { Repository, SyncResult } from "../types"
import { repositoriesApi } from "../api/repositories"

export interface RepositoriesSlice {
  repositories: Repository[]
  isSyncing: boolean
  lastSyncedAt: string | null
  loadRepositories: () => Promise<void>
  syncRepositories: () => Promise<SyncResult>
  setRepositories: (repos: Repository[]) => void
}

export const createRepositoriesSlice: StateCreator<
  RepositoriesSlice,
  [],
  [],
  RepositoriesSlice
> = (set) => ({
  repositories: [],
  isSyncing: false,
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
})
