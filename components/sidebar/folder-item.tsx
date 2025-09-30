"use client"

import { usePathname } from "next/navigation"
import { Folder, FolderOpen, Plus, Edit, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { FolderActionsMenu } from "./folder-actions-menu"
import { FeedItem } from "./feed-item"
import { useRSSStore } from "@/lib/store"
import type { Folder as FolderType, Feed } from "@/lib/types"
import type { RenameDialogState, MoveDialogState, DeleteFolderDialogState } from "./types"

interface FolderItemProps {
  folder: FolderType
  feeds: Feed[]
  isOpen: boolean
  onToggle: () => void
  onAddFeed: () => void
  onRename: (state: RenameDialogState) => void
  onRenameChild: (state: RenameDialogState) => void
  onMoveChild: (state: MoveDialogState) => void
  onDelete: (state: DeleteFolderDialogState) => void
}

export function FolderItem({
  folder,
  feeds,
  isOpen,
  onToggle,
  onAddFeed,
  onRename,
  onRenameChild,
  onMoveChild,
  onDelete,
}: FolderItemProps) {
  const pathname = usePathname()
  const { getUnreadCount } = useRSSStore()

  const folderUnreadCount = feeds.reduce((sum, feed) => sum + getUnreadCount(feed.id), 0)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>
          <Collapsible open={isOpen} onOpenChange={onToggle}>
            <div className="group relative">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 text-left h-auto py-2 px-3 text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  {isOpen ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                  <span className="font-medium truncate">{folder.name}</span>
                  {folderUnreadCount > 0 && (
                    <Badge variant="secondary" className="ml-auto bg-sidebar-accent text-sidebar-accent-foreground text-xs">
                      {folderUnreadCount}
                    </Badge>
                  )}
                </Button>
              </CollapsibleTrigger>

              <FolderActionsMenu
                folderId={folder.id}
                folderName={folder.name}
                feedCount={feeds.length}
                onAddFeed={onAddFeed}
                onRename={onRename}
                onDelete={onDelete}
              />
            </div>

            <CollapsibleContent className="ml-4 space-y-1">
              {feeds.map((feed) => {
                const unreadCount = getUnreadCount(feed.id)
                const isActive = pathname === `/feed/${feed.id}`

                return (
                  <FeedItem
                    key={feed.id}
                    feed={feed}
                    unreadCount={unreadCount}
                    isActive={isActive}
                    variant="full"
                    onRename={onRenameChild}
                    onMove={onMoveChild}
                  />
                )
              })}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={onAddFeed}>
          <Plus className="h-4 w-4 mr-2" />
          Add Feed to Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() =>
            onRename({
              open: true,
              type: "folder",
              id: folder.id,
              currentName: folder.name,
            })
          }
        >
          <Edit className="h-4 w-4 mr-2" />
          Rename Folder
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onClick={() =>
            onDelete({
              open: true,
              folderId: folder.id,
              folderName: folder.name,
              feedCount: feeds.length,
            })
          }
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}