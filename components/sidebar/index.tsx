"use client"

import { CollapsedView } from "./collapsed-view"
import { ExpandedView } from "./expanded-view"
import { AddFeedDialog } from "../add-feed-dialog"
import { AddFolderDialog } from "../add-folder-dialog"
import { RenameDialog } from "../rename-dialog"
import { MoveToFolderDialog } from "../move-to-folder-dialog"
import { DeleteFolderDialog } from "./delete-folder-dialog"
import { DeleteFeedDialog } from "./delete-feed-dialog"
import { useRSSStore } from "@/lib/store"
import { useSidebarState } from "./use-sidebar-state"

export function Sidebar() {
  const { articles, getUnreadCount, isSidebarCollapsed, toggleSidebar, renameFolder, updateFeed } = useRSSStore()

  const {
    showAddFeed,
    setShowAddFeed,
    showAddFolder,
    setShowAddFolder,
    feedSearch,
    setFeedSearch,
    selectedFolderId,
    addFeedFolderId,
    setAddFeedFolderId,
    openFolders,
    toggleFolder,
    renameDialog,
    setRenameDialog,
    moveDialog,
    setMoveDialog,
    deleteDialog,
    setDeleteDialog,
    deleteFeedDialog,
    setDeleteFeedDialog,
  } = useSidebarState()

  const totalArticles = articles.length
  const totalUnread = getUnreadCount()
  const totalStarred = articles.filter((a) => a.isStarred).length

  const handleRenameFolder = async (newName: string) => {
    renameFolder(renameDialog.id, newName)
  }

  const handleRenameFeed = async (newName: string) => {
    updateFeed(renameDialog.id, { title: newName })
  }

  if (isSidebarCollapsed) {
    return (
      <CollapsedView
        onExpand={toggleSidebar}
        totalArticles={totalArticles}
        totalUnread={totalUnread}
        totalStarred={totalStarred}
      />
    )
  }

  return (
    <>
      <ExpandedView
        feedSearch={feedSearch}
        onFeedSearchChange={setFeedSearch}
        openFolders={openFolders}
        onToggleFolder={toggleFolder}
        onCollapse={toggleSidebar}
        onShowAddFeed={(folderId) => {
          setAddFeedFolderId(folderId)
          setShowAddFeed(true)
        }}
        onShowAddFolder={() => setShowAddFolder(true)}
        onRename={setRenameDialog}
        onMove={setMoveDialog}
        onDelete={setDeleteDialog}
        onDeleteFeed={setDeleteFeedDialog}
        totalArticles={totalArticles}
        totalUnread={totalUnread}
        totalStarred={totalStarred}
      />

      <AddFeedDialog
        open={showAddFeed}
        onOpenChange={(open) => {
          setShowAddFeed(open)
          if (!open) setAddFeedFolderId(undefined)
        }}
        defaultFolderId={addFeedFolderId || selectedFolderId}
        lockFolder={!!addFeedFolderId}
      />
      <AddFolderDialog open={showAddFolder} onOpenChange={setShowAddFolder} />
      <RenameDialog
        open={renameDialog.open}
        onOpenChange={(open) => setRenameDialog((prev) => ({ ...prev, open }))}
        title={renameDialog.type === "folder" ? "Rename Folder" : "Rename Feed"}
        description={`Enter a new name for this ${renameDialog.type}.`}
        currentName={renameDialog.currentName}
        onRename={renameDialog.type === "folder" ? handleRenameFolder : handleRenameFeed}
      />
      <MoveToFolderDialog
        open={moveDialog.open}
        onOpenChange={(open) => setMoveDialog((prev) => ({ ...prev, open }))}
        feedId={moveDialog.feedId}
        feedTitle={moveDialog.feedTitle}
        currentFolderId={moveDialog.currentFolderId}
      />
      <DeleteFolderDialog
        state={deleteDialog}
        onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}
      />
      <DeleteFeedDialog
        state={deleteFeedDialog}
        onOpenChange={(open) => setDeleteFeedDialog((prev) => ({ ...prev, open }))}
      />
    </>
  )
}