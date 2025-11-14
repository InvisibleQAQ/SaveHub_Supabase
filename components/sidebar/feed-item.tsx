"use client"

import { useState } from "react"
import Link from "next/link"
import { Rss, Edit, Trash2, Check, ExternalLink, Settings, AlertCircle, RefreshCw, ArrowRightToLine, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useRSSStore } from "@/lib/store"
import { parseRSSFeed } from "@/lib/rss-parser"
import { useToast } from "@/hooks/use-toast"
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
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { markFeedAsRead, addArticles, updateFeed } = useRSSStore()
  const { toast } = useToast()
  const router = useRouter()

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

  const handleEditProperties = (e: React.MouseEvent) => {
    e.preventDefault()
    router.push(`/feed/${feed.id}/properties`)
  }

  const handleRefresh = async (e: React.MouseEvent) => {
    e.preventDefault()

    if (isRefreshing) return

    setIsRefreshing(true)
    try {
      const { articles } = await parseRSSFeed(feed.url, feed.id)
      const newArticlesCount = addArticles(articles)
      updateFeed(feed.id, { lastFetched: new Date() })

      toast({
        title: "Feed refreshed",
        description: newArticlesCount === 0
          ? `"${feed.title}" has no new articles`
          : `Found ${newArticlesCount} new article${newArticlesCount > 1 ? 's' : ''} in "${feed.title}"`,
      })
    } catch (error) {
      console.error(`Error refreshing feed ${feed.title}:`, error)
      toast({
        title: "Refresh failed",
        description: error instanceof Error ? error.message : "Failed to refresh feed",
        variant: "destructive",
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleMove = (e: React.MouseEvent) => {
    e.preventDefault()
    onMove?.({
      open: true,
      feedId: feed.id,
      feedTitle: feed.title,
      currentFolderId: feed.folderId,
    })
  }

  if (variant === "icon") {
    const iconContent = (
      <div className="relative">
        <Rss className="h-4 w-4" />
        {feed.lastFetchStatus === "failed" && (
          <AlertCircle className="absolute -top-1 -left-1 h-3 w-3 text-destructive" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-[9px] font-medium">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>
    )

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  size="icon"
                  className={cn(
                    "h-10 w-10 flex items-center justify-center",
                    isActive && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
                  )}
                  asChild
                >
                  <Link href={`/feed/${feed.id}`}>
                    {iconContent}
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">{feed.title}</p>
                {feed.lastFetchStatus === "failed" && (
                  <p className="text-xs text-destructive mt-1">
                    Last refresh failed: {feed.lastFetchError || "Unknown error"}
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleRefresh} disabled={isRefreshing}>
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh Feed
          </ContextMenuItem>
          {onMove && (
            <ContextMenuItem onClick={handleMove}>
              <ArrowRightToLine className="h-4 w-4 mr-2" />
              Move to Folder
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleEditProperties}>
            <Settings className="h-4 w-4 mr-2" />
            Edit Feed Properties
          </ContextMenuItem>
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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-medium truncate">{feed.title}</span>
                    {feed.lastFetchStatus === "failed" && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Last refresh failed</p>
                            {feed.lastFetchError && (
                              <p className="text-xs text-muted-foreground mt-1">{feed.lastFetchError}</p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <Badge variant="secondary" className="ml-2 bg-sidebar-accent text-sidebar-accent-foreground text-xs flex-shrink-0">
                      {unreadCount}
                    </Badge>
                  )}
                </div>
              </div>
            </Link>
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh Feed
        </ContextMenuItem>
        {onMove && (
          <ContextMenuItem onClick={handleMove}>
            <ArrowRightToLine className="h-4 w-4 mr-2" />
            Move to Folder
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleEditProperties}>
          <Settings className="h-4 w-4 mr-2" />
          Edit Feed Properties
        </ContextMenuItem>
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