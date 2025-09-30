"use client"

import { usePathname } from "next/navigation"
import { Folder, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { FolderActionsMenu } from "./folder-actions-menu"
import { FeedItem } from "./feed-item"
import { useRSSStore } from "@/lib/store"
import type { Folder as FolderType, Feed } from "@/lib/types"
import type { RenameDialogState, MoveDialogState } from "./types"

interface FolderItemProps {
  folder: FolderType
  feeds: Feed[]
  isOpen: boolean
  onToggle: () => void
  onAddFeed: () => void
  onRename: (state: RenameDialogState) => void
  onRenameChild: (state: RenameDialogState) => void
  onMoveChild: (state: MoveDialogState) => void
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
}: FolderItemProps) {
  const pathname = usePathname()
  const { getUnreadCount } = useRSSStore()

  const folderUnreadCount = feeds.reduce((sum, feed) => sum + getUnreadCount(feed.id), 0)

  return (
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

        <FolderActionsMenu folderId={folder.id} folderName={folder.name} onAddFeed={onAddFeed} onRename={onRename} />
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
  )
}