"use client"

import { MoreHorizontal, Plus, Edit, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useRSSStore } from "@/lib/store"
import type { RenameDialogState } from "./types"

interface FolderActionsMenuProps {
  folderId: string
  folderName: string
  onAddFeed: () => void
  onRename: (state: RenameDialogState) => void
}

export function FolderActionsMenu({ folderId, folderName, onAddFeed, onRename }: FolderActionsMenuProps) {
  const { removeFolder } = useRSSStore()

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
        <DropdownMenuItem onClick={onAddFeed}>
          <Plus className="h-4 w-4 mr-2" />
          Add Feed to Folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            onRename({
              open: true,
              type: "folder",
              id: folderId,
              currentName: folderName,
            })
          }
        >
          <Edit className="h-4 w-4 mr-2" />
          Rename Folder
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => removeFolder(folderId)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}