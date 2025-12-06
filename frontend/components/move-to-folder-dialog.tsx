"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRSSStore } from "@/lib/store"

interface MoveToFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  feedId: string
  feedTitle: string
  currentFolderId?: string
}

export function MoveToFolderDialog({
  open,
  onOpenChange,
  feedId,
  feedTitle,
  currentFolderId,
}: MoveToFolderDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>(currentFolderId || "")
  const [isLoading, setIsLoading] = useState(false)
  const { folders, updateFeed } = useRSSStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedFolderId === currentFolderId) {
      onOpenChange(false)
      return
    }

    setIsLoading(true)
    try {
      updateFeed(feedId, {
        folderId: selectedFolderId === "none" ? undefined : selectedFolderId,
      })
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to move feed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Move Feed to Folder</DialogTitle>
          <DialogDescription>Move "{feedTitle}" to a different folder or remove it from folders.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="folder" className="text-right">
                Folder
              </Label>
              <Select value={selectedFolderId} onValueChange={setSelectedFolderId}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select a folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Folder</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Moving..." : "Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
