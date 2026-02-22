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
import { useToast } from "@/hooks/use-toast"
import { useTranslations } from "next-intl"

interface AddFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddFolderDialog({ open, onOpenChange }: AddFolderDialogProps) {
  const t = useTranslations("reader.addFolderDialog")
  const [folderName, setFolderName] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { addFolder } = useRSSStore()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folderName.trim()) return

    setIsLoading(true)
    try {
      const result = await addFolder({
        name: folderName.trim(),
      })

      if (result.success) {
        toast({
          title: t("toasts.successTitle"),
          description: t("toasts.folderCreated", { folderName: folderName.trim() }),
        })
        setFolderName("")
        onOpenChange(false)
      } else {
        if (result.error === 'duplicate') {
          toast({
            title: t("toasts.errorTitle"),
            description: t("toasts.folderAlreadyExists", { folderName: folderName.trim() }),
            variant: "destructive",
          })
        } else {
          toast({
            title: t("toasts.errorTitle"),
            description: t("toasts.failedToCreateFolder"),
            variant: "destructive",
          })
        }
      }
    } catch (error) {
      console.error("Failed to add folder:", error)
      toast({
        title: t("toasts.errorTitle"),
        description: t("toasts.failedToCreateFolder"),
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="folder-name" className="text-right">
                {t("fields.name")}
              </Label>
              <Input
                id="folder-name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder={t("fields.namePlaceholder")}
                className="col-span-3"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={isLoading || !folderName.trim()}>
              {isLoading ? t("actions.adding") : t("actions.addFolder")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
