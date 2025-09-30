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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRSSStore } from "@/lib/store"

interface AddFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddFolderDialog({ open, onOpenChange }: AddFolderDialogProps) {
  const [folderName, setFolderName] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { addFolder } = useRSSStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folderName.trim()) return

    setIsLoading(true)
    try {
      addFolder({
        name: folderName.trim(),
      })
      setFolderName("")
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to add folder:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Folder</DialogTitle>
          <DialogDescription>Create a new folder to organize your RSS feeds.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="folder-name" className="text-right">
                Name
              </Label>
              <Input
                id="folder-name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Enter folder name"
                className="col-span-3"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !folderName.trim()}>
              {isLoading ? "Adding..." : "Add Folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
