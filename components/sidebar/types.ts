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