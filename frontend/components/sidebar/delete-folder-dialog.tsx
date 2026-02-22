"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useRSSStore } from "@/lib/store"
import type { DeleteFolderDialogState } from "./types"
import { useTranslations } from "next-intl"

interface DeleteFolderDialogProps {
  state: DeleteFolderDialogState
  onOpenChange: (open: boolean) => void
}

type DeleteMode = "dissolve" | "delete-all"

export function DeleteFolderDialog({ state, onOpenChange }: DeleteFolderDialogProps) {
  const t = useTranslations("sidebar.deleteFolderDialog")
  const { removeFolder } = useRSSStore()
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("dissolve")
  const [showConfirmation, setShowConfirmation] = useState(false)

  const handleClose = () => {
    onOpenChange(false)
    setShowConfirmation(false)
    setDeleteMode("dissolve")
  }

  const handleNext = (e: React.MouseEvent) => {
    e.preventDefault()
    setShowConfirmation(true)
  }

  const handleConfirm = async () => {
    const deleteFeeds = deleteMode === "delete-all"
    await removeFolder(state.folderId, deleteFeeds)
    handleClose()
  }

  const getModeDescription = () => {
    if (deleteMode === "dissolve") {
      return t("confirmDissolveDescription", {
        folderName: state.folderName,
        feedCount: state.feedCount,
      })
    } else {
      return t("confirmDeleteAllDescription", {
        folderName: state.folderName,
        feedCount: state.feedCount,
      })
    }
  }

  return (
    <AlertDialog open={state.open} onOpenChange={handleClose}>
      <AlertDialogContent>
        {!showConfirmation ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("description", { folderName: state.folderName })}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="py-4 space-y-3">
              <div
                onClick={() => setDeleteMode("dissolve")}
                className={`rounded-md border-2 p-4 cursor-pointer transition-colors ${
                  deleteMode === "dissolve"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="space-y-1">
                  <div className="font-medium">{t("options.keepFeedsTitle")}</div>
                  <p className="text-sm text-muted-foreground">
                    {t("options.keepFeedsDescription")}
                  </p>
                </div>
              </div>

              <div
                onClick={() => setDeleteMode("delete-all")}
                className={`rounded-md border-2 p-4 cursor-pointer transition-colors ${
                  deleteMode === "delete-all"
                    ? "border-destructive bg-destructive/5"
                    : "border-border hover:border-destructive/50"
                }`}
              >
                <div className="space-y-1">
                  <div className="font-medium text-destructive">{t("options.deleteAllFeedsTitle")}</div>
                  <p className="text-sm text-muted-foreground">
                    {t("options.deleteAllFeedsDescription", { feedCount: state.feedCount })}
                  </p>
                </div>
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>{t("buttons.cancel")}</AlertDialogCancel>
              <Button onClick={handleNext}>{t("buttons.next")}</Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{getModeDescription()}</AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setShowConfirmation(false)}>{t("buttons.back")}</Button>
              <Button
                onClick={handleConfirm}
                variant={deleteMode === "delete-all" ? "destructive" : "default"}
              >
                {deleteMode === "delete-all" ? t("buttons.deleteAll") : t("buttons.deleteFolder")}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
