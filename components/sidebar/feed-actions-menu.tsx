"use client"

import { MoreHorizontal, RefreshCw, ArrowRightToLine, Edit, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { FeedRefresh } from "../feed-refresh"
import { useRSSStore } from "@/lib/store"
import type { RenameDialogState, MoveDialogState } from "./types"

interface FeedActionsMenuProps {
  feedId: string
  feedTitle: string
  folderId?: string
  onRename: (state: RenameDialogState) => void
  onMove: (state: MoveDialogState) => void
}

export function FeedActionsMenu({ feedId, feedTitle, folderId, onRename, onMove }: FeedActionsMenuProps) {
  const { removeFeed } = useRSSStore()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <MoreHorizontal className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-sidebar border-sidebar-border">
        <DropdownMenuItem asChild>
          <div className="flex items-center cursor-pointer">
            <RefreshCw className="h-4 w-4 mr-2" />
            <FeedRefresh feedId={feedId} className="p-0 h-auto w-auto hover:bg-transparent" />
            <span className="ml-2">Refresh Feed</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            onMove({
              open: true,
              feedId,
              feedTitle,
              currentFolderId: folderId,
            })
          }
        >
          <ArrowRightToLine className="h-4 w-4 mr-2" />
          Move to Folder
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            onRename({
              open: true,
              type: "feed",
              id: feedId,
              currentName: feedTitle,
            })
          }
        >
          <Edit className="h-4 w-4 mr-2" />
          Rename Feed
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => removeFeed(feedId)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Remove Feed
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}