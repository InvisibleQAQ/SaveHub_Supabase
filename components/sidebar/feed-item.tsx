"use client"

import Link from "next/link"
import { Rss, Edit, Trash2, Check, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { FeedActionsMenu } from "./feed-actions-menu"
import { useRSSStore } from "@/lib/store"
import type { Feed } from "@/lib/types"
import type { RenameDialogState, MoveDialogState, DeleteFeedDialogState } from "./types"

interface FeedItemProps {
  feed: Feed
  unreadCount: number
  isActive: boolean
  variant: "icon" | "full"
  onRename?: (state: RenameDialogState) => void
  onMove?: (state: MoveDialogState) => void
  onDelete?: (state: DeleteFeedDialogState) => void
  onDragStart?: (feedId: string) => void
  onDragOver?: (e: React.DragEvent, feedId: string) => void
  onDrop?: (e: React.DragEvent, feedId: string) => void
  isDragging?: boolean
}

export function FeedItem({ feed, unreadCount, isActive, variant, onRename, onMove, onDelete, onDragStart, onDragOver, onDrop, isDragging }: FeedItemProps) {
  const { markFeedAsRead } = useRSSStore()

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    onDragStart?.(feed.id)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDragOver?.(e, feed.id)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDrop?.(e, feed.id)
  }

  const handleMarkAllAsRead = (e: React.MouseEvent) => {
    e.preventDefault()
    markFeedAsRead(feed.id)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    onDelete?.({
      open: true,
      feedId: feed.id,
      feedTitle: feed.title,
    })
  }

  const handleRename = (e: React.MouseEvent) => {
    e.preventDefault()
    onRename?.({
      open: true,
      type: "feed",
      id: feed.id,
      currentName: feed.title,
    })
  }

  const handleOpenURL = (e: React.MouseEvent) => {
    e.preventDefault()
    window.open(feed.url, "_blank", "noopener,noreferrer")
  }

  if (variant === "icon") {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            variant={isActive ? "secondary" : "ghost"}
            size="icon"
            className={cn(
              "h-10 w-10 flex items-center justify-center",
              isActive && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
            )}
            title={feed.title}
            asChild
          >
            <Link href={`/feed/${feed.id}`}>
              <Rss className="h-4 w-4" />
            </Link>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleRename}>
            <Edit className="h-4 w-4 mr-2" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={handleDelete} variant="destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleMarkAllAsRead}>
            <Check className="h-4 w-4 mr-2" />
            Mark all as read
          </ContextMenuItem>
          <ContextMenuItem onClick={handleOpenURL}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Feed URL
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative transition-opacity",
            isDragging && "opacity-50 cursor-move"
          )}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start gap-3 text-left h-auto py-2 px-3 text-sidebar-foreground",
              isActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
                : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
            asChild
          >
            <Link href={`/feed/${feed.id}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium truncate">{feed.title}</span>
                  {unreadCount > 0 && (
                    <Badge variant="secondary" className="ml-2 bg-sidebar-accent text-sidebar-accent-foreground text-xs">
                      {unreadCount}
                    </Badge>
                  )}
                </div>
                {feed.description && (
                  <p className="text-xs text-sidebar-foreground/60 truncate mt-1">{feed.description}</p>
                )}
                {feed.lastFetched && (
                  <p className="text-xs text-sidebar-foreground/40 mt-1">
                    Updated {new Date(feed.lastFetched).toLocaleDateString()}
                  </p>
                )}
              </div>
            </Link>
          </Button>

          {onRename && onMove && onDelete && (
            <FeedActionsMenu
              feedId={feed.id}
              feedTitle={feed.title}
              folderId={feed.folderId}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleRename}>
          <Edit className="h-4 w-4 mr-2" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={handleDelete} variant="destructive">
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleMarkAllAsRead}>
          <Check className="h-4 w-4 mr-2" />
          Mark all as read
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpenURL}>
          <ExternalLink className="h-4 w-4 mr-2" />
          Open Feed URL
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}