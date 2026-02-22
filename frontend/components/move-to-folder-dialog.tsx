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
import { useTranslations } from "next-intl"

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
  const t = useTranslations("reader.moveToFolderDialog")
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
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { feedTitle })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="folder" className="text-right">
                {t("fields.folder")}
              </Label>
              <Select value={selectedFolderId} onValueChange={setSelectedFolderId}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={t("fields.selectFolder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("fields.noFolder")}</SelectItem>
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
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? t("actions.moving") : t("actions.move")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
