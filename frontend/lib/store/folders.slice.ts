import type { StateCreator } from "zustand"
import type { Folder } from "../types"
import { foldersApi } from "../api/folders"
import { feedsApi } from "../api/feeds"

export interface FoldersSlice {
  addFolder: (folder: Omit<Folder, "id" | "createdAt" | "order">) => Promise<{ success: boolean; error?: string }>
  removeFolder: (folderId: string, deleteFeeds?: boolean) => Promise<{ success: boolean; error?: string }>
  renameFolder: (folderId: string, newName: string) => Promise<{ success: boolean; error?: string }>
  moveFolder: (folderId: string, targetOrder: number) => Promise<void>
}

export const createFoldersSlice: StateCreator<
  any,
  [],
  [],
  FoldersSlice
> = (set, get) => ({
  addFolder: async (folder) => {
    const state = get() as any
    const maxOrder = state.folders.reduce((max: number, f: any) => Math.max(max, f.order ?? -1), -1)

    const newFolder: Folder = {
      ...folder,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      order: maxOrder + 1,
    }

    try {
      // Pessimistic update: save to API first
      await foldersApi.saveFolders([newFolder])

      // API succeeded, update local store
      set((state: any) => ({
        folders: [...state.folders, newFolder],
      }))

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown'
      if (errorMessage === 'duplicate') {
        return { success: false, error: 'duplicate' }
      }
      console.error('Failed to add folder:', error)
      return { success: false, error: errorMessage }
    }
  },

  removeFolder: async (folderId, deleteFeeds = false) => {
    try {
      const state = get() as any
      const folderFeeds = state.feeds.filter((f: any) => f.folderId === folderId)
      const feedIds = folderFeeds.map((f: any) => f.id)

      if (deleteFeeds && feedIds.length > 0) {
        // Delete feeds first (API will cascade delete articles)
        await Promise.all(feedIds.map((id: string) => feedsApi.deleteFeed(id)))
      }

      // Delete folder from API
      await foldersApi.deleteFolder(folderId)

      // API succeeded, update local store
      if (deleteFeeds) {
        set((state: any) => ({
          folders: state.folders.filter((f: any) => f.id !== folderId),
          feeds: state.feeds.filter((f: any) => f.folderId !== folderId),
          articles: state.articles.filter((a: any) => !feedIds.includes(a.feedId)),
        }))
      } else {
        // Feeds remain but lose their folder reference (handled by backend)
        set((state: any) => ({
          folders: state.folders.filter((f: any) => f.id !== folderId),
          feeds: state.feeds.map((feed: any) =>
            feed.folderId === folderId ? { ...feed, folderId: undefined } : feed
          ),
        }))
      }

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown'
      console.error("Failed to delete folder:", error)
      return { success: false, error: errorMessage }
    }
  },

  renameFolder: async (folderId, newName) => {
    try {
      // Pessimistic update: call API first
      await foldersApi.updateFolder(folderId, { name: newName })

      // API succeeded, update local store
      set((state: any) => ({
        folders: state.folders.map((folder: any) =>
          folder.id === folderId ? { ...folder, name: newName } : folder
        ),
      }))

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown'
      console.error("Failed to rename folder:", error)
      return { success: false, error: errorMessage }
    }
  },

  moveFolder: async (folderId, targetOrder) => {
    const state = get() as any
    const folders = [...state.folders]
    const folderIndex = folders.findIndex((f) => f.id === folderId)
    if (folderIndex === -1) return

    const [movedFolder] = folders.splice(folderIndex, 1)
    folders.splice(targetOrder, 0, movedFolder)

    const updatedFolders = folders.map((folder, index) => ({ ...folder, order: index }))

    try {
      // Save all folders to API (to persist order changes)
      await foldersApi.saveFolders(updatedFolders)

      // Update local store
      set({ folders: updatedFolders })
    } catch (error) {
      console.error("Failed to save folder order:", error)
      // On error, don't update local store to keep it consistent with API
    }
  },
})
