"use client"

import { CollapsedView } from "./collapsed-view"
import { ExpandedView } from "./expanded-view"
import { AddFeedDialog } from "../add-feed-dialog"
import { AddFolderDialog } from "../add-folder-dialog"
import { RenameDialog } from "../rename-dialog"
import { MoveToFolderDialog } from "../move-to-folder-dialog"
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
    openFolders,
    toggleFolder,
    renameDialog,
    setRenameDialog,
    moveDialog,
    setMoveDialog,
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
        onShowAddFeed={() => setShowAddFeed(true)}
        onShowAddFolder={() => setShowAddFolder(true)}
        onRename={setRenameDialog}
        onMove={setMoveDialog}
        totalArticles={totalArticles}
        totalUnread={totalUnread}
        totalStarred={totalStarred}
      />

      <AddFeedDialog open={showAddFeed} onOpenChange={setShowAddFeed} defaultFolderId={selectedFolderId} />
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
    </>
  )
}