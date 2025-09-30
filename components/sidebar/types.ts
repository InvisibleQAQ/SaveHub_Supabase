export interface RenameDialogState {
  open: boolean
  type: "folder" | "feed"
  id: string
  currentName: string
}

export interface MoveDialogState {
  open: boolean
  feedId: string
  feedTitle: string
  currentFolderId?: string
}

export interface DeleteFolderDialogState {
  open: boolean
  folderId: string
  folderName: string
  feedCount: number
}

export interface DeleteFeedDialogState {
  open: boolean
  feedId: string
  feedTitle: string
}