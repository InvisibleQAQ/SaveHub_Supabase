"use client"

import Link from "next/link"
import { Rss } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { FeedActionsMenu } from "./feed-actions-menu"
import type { Feed } from "@/lib/types"
import type { RenameDialogState, MoveDialogState } from "./types"

interface FeedItemProps {
  feed: Feed
  unreadCount: number
  isActive: boolean
  variant: "icon" | "full"
  onRename?: (state: RenameDialogState) => void
  onMove?: (state: MoveDialogState) => void
}

export function FeedItem({ feed, unreadCount, isActive, variant, onRename, onMove }: FeedItemProps) {
  if (variant === "icon") {
    return (
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
    )
  }

  return (
    <div className="group relative">
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

      {onRename && onMove && (
        <FeedActionsMenu
          feedId={feed.id}
          feedTitle={feed.title}
          folderId={feed.folderId}
          onRename={onRename}
          onMove={onMove}
        />
      )}
    </div>
  )
}