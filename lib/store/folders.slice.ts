import type { StateCreator } from "zustand"
import type { Folder } from "../types"
import { dbManager } from "../db"

export interface FoldersSlice {
  addFolder: (folder: Omit<Folder, "id" | "createdAt" | "order">) => void
  removeFolder: (folderId: string, deleteFeeds?: boolean) => Promise<void>
  renameFolder: (folderId: string, newName: string) => void
  moveFolder: (folderId: string, targetOrder: number) => void
}

export const createFoldersSlice: StateCreator<
  FoldersSlice,
  [],
  [],
  FoldersSlice
> = (set, get) => ({
  addFolder: (folder) => {
    const state = get()
    const maxOrder = state.folders.reduce((max, f) => Math.max(max, f.order ?? -1), -1)

    const newFolder: Folder = {
      ...folder,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      order: maxOrder + 1,
    }

    set((state) => ({
      folders: [...state.folders, newFolder],
    }))

    get().syncToSupabase?.()
  },

  removeFolder: async (folderId, deleteFeeds = false) => {
    const state = get() as any
    const folderFeeds = state.feeds.filter((f: any) => f.folderId === folderId)
    const feedIds = folderFeeds.map((f) => f.id)

    if (deleteFeeds) {
      set((state: any) => ({
        folders: state.folders.filter((f: any) => f.id !== folderId),
        feeds: state.feeds.filter((f: any) => f.folderId !== folderId),
        articles: state.articles.filter((a: any) => !feedIds.includes(a.feedId)),
      }))

      try {
        await Promise.all(feedIds.map((id) => dbManager.deleteFeed(id)))
        await dbManager.deleteFolder(folderId)
      } catch (error) {
        console.error("Failed to delete folder and feeds:", error)
      }
    } else {
      set((state: any) => ({
        folders: state.folders.filter((f: any) => f.id !== folderId),
        feeds: state.feeds.map((feed: any) => (feed.folderId === folderId ? { ...feed, folderId: undefined } : feed)),
      }))

      try {
        await dbManager.deleteFolder(folderId)
        await (get() as any).syncToSupabase?.()
      } catch (error) {
        console.error("Failed to delete folder:", error)
      }
    }
  },

  renameFolder: (folderId, newName) => {
    set((state: any) => ({
      folders: state.folders.map((folder: any) => (folder.id === folderId ? { ...folder, name: newName } : folder)),
    }))

    (get() as any).syncToSupabase?.()
  },

  moveFolder: (folderId, targetOrder) => {
    set((state: any) => {
      const folders = [...state.folders]
      const folderIndex = folders.findIndex((f) => f.id === folderId)
      if (folderIndex === -1) return state

      const [movedFolder] = folders.splice(folderIndex, 1)
      folders.splice(targetOrder, 0, movedFolder)

      return {
        folders: folders.map((folder, index) => ({ ...folder, order: index })),
      }
    })

    (get() as any).syncToSupabase?.()
  },
})
