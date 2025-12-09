"use client"

import React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Search, BookOpen, Rss, Star, Plus, FolderPlus, ChevronLeft, Settings, LogOut, Pin, PinOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { ViewButton } from "./view-button"
import { FolderItem } from "./folder-item"
import { FeedItem } from "./feed-item"
import { HelpDialog } from "../help-dialog"
import { FeedRefresh } from "../feed-refresh"
import { useRSSStore } from "@/lib/store"
import { useAuth } from "@/lib/context/auth-context"
import { cn } from "@/lib/utils"
import type { Feed, Folder } from "@/lib/types"
import type { RenameDialogState, MoveDialogState, DeleteFolderDialogState, DeleteFeedDialogState } from "./types"

interface ExpandedViewProps {
  feedSearch: string
  onFeedSearchChange: (value: string) => void
  openFolders: Set<string>
  onToggleFolder: (folderId: string) => void
  onCollapse: () => void
  onShowAddFeed: (folderId?: string) => void
  onShowAddFolder: () => void
  onRename: (state: RenameDialogState) => void
  onMove: (state: MoveDialogState) => void
  onDelete: (state: DeleteFolderDialogState) => void
  onDeleteFeed: (state: DeleteFeedDialogState) => void
  totalArticles: number
  totalUnread: number
  totalStarred: number
  sidebarPinned: boolean
  onTogglePin: () => void
}

export function ExpandedView({
  feedSearch,
  onFeedSearchChange,
  openFolders,
  onToggleFolder,
  onCollapse,
  onShowAddFeed,
  onShowAddFolder,
  onRename,
  onMove,
  onDelete,
  onDeleteFeed,
  totalArticles,
  totalUnread,
  totalStarred,
  sidebarPinned,
  onTogglePin,
}: ExpandedViewProps) {
  const pathname = usePathname()
  const { logout } = useAuth()
  const { folders, feeds, getUnreadCount, moveFeed } = useRSSStore()
  const [draggedFeedId, setDraggedFeedId] = React.useState<string | null>(null)

  const handleLogout = async () => {
    await logout()
  }

  const filteredFolders = folders.filter((folder) => folder.name.toLowerCase().includes(feedSearch.toLowerCase()))

  const filteredFeeds = feeds.filter(
    (feed) =>
      feed.title.toLowerCase().includes(feedSearch.toLowerCase()) ||
      feed.description?.toLowerCase().includes(feedSearch.toLowerCase())
  )

  const feedsByFolder = filteredFeeds.reduce(
    (acc, feed) => {
      const folderId = feed.folderId || "none"
      if (!acc[folderId]) acc[folderId] = []
      acc[folderId].push(feed)
      return acc
    },
    {} as Record<string, Feed[]>
  )

  const handleFeedDragStart = (feedId: string) => {
    setDraggedFeedId(feedId)
  }

  const handleFeedDragOver = (e: React.DragEvent, targetFeedId: string) => {
    e.preventDefault()
  }

  const handleFeedDrop = (e: React.DragEvent, targetFeedId: string) => {
    e.preventDefault()
    if (!draggedFeedId || draggedFeedId === targetFeedId) return

    const draggedFeed = feeds.find((f) => f.id === draggedFeedId)
    const targetFeed = feeds.find((f) => f.id === targetFeedId)
    if (!draggedFeed || !targetFeed) return

    const targetFolderId = targetFeed.folderId
    const sameFolderFeeds = feeds
      .filter((f) => (f.folderId || undefined) === (targetFolderId || undefined))
      .sort((a, b) => a.order - b.order)

    const targetIndex = sameFolderFeeds.findIndex((f) => f.id === targetFeedId)

    moveFeed(draggedFeedId, targetFolderId, targetIndex)
    setDraggedFeedId(null)
  }

  const handleDropOnFolder = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    if (!draggedFeedId) return

    const draggedFeed = feeds.find((f) => f.id === draggedFeedId)
    if (!draggedFeed) return

    moveFeed(draggedFeedId, folderId, 0)
    setDraggedFeedId(null)
  }

  const handleDragOverFolder = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDropOnRootLevel = (e: React.DragEvent) => {
    e.preventDefault()
    if (!draggedFeedId) return

    const draggedFeed = feeds.find((f) => f.id === draggedFeedId)
    if (!draggedFeed) return

    const rootLevelFeeds = feeds
      .filter((f) => !f.folderId)
      .sort((a, b) => a.order - b.order)

    moveFeed(draggedFeedId, undefined, rootLevelFeeds.length)
    setDraggedFeedId(null)
  }

  const handleDragOverRootLevel = (e: React.DragEvent) => {
    e.preventDefault()
  }

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-sidebar-foreground">RSS Reader</h1>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent",
                sidebarPinned && "bg-sidebar-accent"
              )}
              title={sidebarPinned ? "Unpin sidebar" : "Pin sidebar"}
              onClick={onTogglePin}
            >
              {sidebarPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
              title="Collapse sidebar"
              onClick={onCollapse}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <HelpDialog />
            <FeedRefresh className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent" />
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-sidebar-foreground/60" />
          <Input
            placeholder="Search feeds and folders..."
            value={feedSearch}
            onChange={(e) => onFeedSearchChange(e.target.value)}
            className="pl-9 bg-sidebar-accent border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/60"
          />
        </div>
      </div>

      {/* View Mode Filters */}
      <div className="p-4 space-y-2">
        <ViewButton href="/all" icon={BookOpen} label="All Articles" count={totalArticles} isActive={pathname === "/all"} variant="full" />
        <ViewButton href="/unread" icon={Rss} label="Unread" count={totalUnread} isActive={pathname === "/unread"} variant="full" />
        <ViewButton href="/starred" icon={Star} label="Starred" count={totalStarred} isActive={pathname === "/starred"} variant="full" />

        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => onShowAddFeed()}
        >
          <Plus className="h-4 w-4" />
          Add Feed
        </Button>

        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={onShowAddFolder}
        >
          <FolderPlus className="h-4 w-4" />
          Add Folder
        </Button>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Feeds and Folders List */}
      <div className="flex-1 overflow-hidden">
        <div className="p-4 pb-2">
          <h2 className="text-sm font-medium text-sidebar-foreground/80 uppercase tracking-wide">
            Feeds ({filteredFeeds.length})
          </h2>
        </div>

        <ScrollArea className="flex-1 px-4 custom-scrollbar">
          <div className="space-y-1 pb-4">
            {/* Folders */}
            {filteredFolders.map((folder) => {
              const folderFeeds = feedsByFolder[folder.id] || []
              return (
                <FolderItem
                  key={folder.id}
                  folder={folder}
                  feeds={folderFeeds}
                  isOpen={openFolders.has(folder.id)}
                  onToggle={() => onToggleFolder(folder.id)}
                  onAddFeed={() => onShowAddFeed(folder.id)}
                  onRename={onRename}
                  onRenameChild={onRename}
                  onMoveChild={onMove}
                  onDelete={onDelete}
                  onDeleteChild={onDeleteFeed}
                  onDragOverFolder={handleDragOverFolder}
                  onDropOnFolder={handleDropOnFolder}
                  onFeedDragStart={handleFeedDragStart}
                  onFeedDragOver={handleFeedDragOver}
                  onFeedDrop={handleFeedDrop}
                  draggedFeedId={draggedFeedId}
                />
              )
            })}

            {/* Feeds without folders */}
            <div
              onDragOver={handleDragOverRootLevel}
              onDrop={handleDropOnRootLevel}
              className={cn(
                "min-h-[60px] rounded-md transition-colors",
                draggedFeedId && "bg-sidebar-accent/30 border-2 border-dashed border-sidebar-border"
              )}
            >
              {feedsByFolder.none?.map((feed) => {
                const unreadCount = getUnreadCount(feed.id)
                const isActive = pathname === `/feed/${feed.id}`
                return (
                  <FeedItem
                    key={feed.id}
                    feed={feed}
                    unreadCount={unreadCount}
                    isActive={isActive}
                    variant="full"
                    onRename={onRename}
                    onMove={onMove}
                    onDelete={onDeleteFeed}
                    onDragStart={handleFeedDragStart}
                    onDragOver={handleFeedDragOver}
                    onDrop={handleFeedDrop}
                    isDragging={draggedFeedId === feed.id}
                  />
                )
              })}
              {draggedFeedId && (!feedsByFolder.none || feedsByFolder.none.length === 0) && (
                <div className="flex items-center justify-center h-[60px] text-xs text-sidebar-foreground/40">
                  Drop here to move to root level
                </div>
              )}
            </div>

            {filteredFeeds.length === 0 && feeds.length > 0 && (
              <div className="text-center py-8 text-sidebar-foreground/60">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No feeds match your search</p>
              </div>
            )}

            {feeds.length === 0 && (
              <div className="text-center py-8 text-sidebar-foreground/60">
                <Rss className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No feeds added yet</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onShowAddFeed}
                  className="mt-2 text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  Add your first feed
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border space-y-2">
        <Button
          variant={pathname.startsWith("/settings") ? "secondary" : "ghost"}
          size="sm"
          className={cn(
            "w-full justify-start gap-2 text-sidebar-foreground",
            pathname.startsWith("/settings")
              ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
              : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
          asChild
        >
          <Link href="/settings">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  )
}