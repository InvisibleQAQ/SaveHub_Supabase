import { useState } from "react"
import type { RenameDialogState, MoveDialogState } from "./types"

export function useSidebarState() {
  const [showAddFeed, setShowAddFeed] = useState(false)
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [feedSearch, setFeedSearch] = useState("")
  const [selectedFolderId, setSelectedFolderId] = useState<string>("")
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())

  const [renameDialog, setRenameDialog] = useState<RenameDialogState>({
    open: false,
    type: "folder",
    id: "",
    currentName: "",
  })

  const [moveDialog, setMoveDialog] = useState<MoveDialogState>({
    open: false,
    feedId: "",
    feedTitle: "",
    currentFolderId: undefined,
  })

  const toggleFolder = (folderId: string) => {
    const newOpenFolders = new Set(openFolders)
    if (newOpenFolders.has(folderId)) {
      newOpenFolders.delete(folderId)
    } else {
      newOpenFolders.add(folderId)
    }
    setOpenFolders(newOpenFolders)
  }

  return {
    showAddFeed,
    setShowAddFeed,
    showAddFolder,
    setShowAddFolder,
    feedSearch,
    setFeedSearch,
    selectedFolderId,
    setSelectedFolderId,
    openFolders,
    toggleFolder,
    renameDialog,
    setRenameDialog,
    moveDialog,
    setMoveDialog,
  }
}