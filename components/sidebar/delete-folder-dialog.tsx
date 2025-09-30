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
import { useRSSStore } from "@/lib/store"
import type { DeleteFolderDialogState } from "./types"

interface DeleteFolderDialogProps {
  state: DeleteFolderDialogState
  onOpenChange: (open: boolean) => void
}

type DeleteMode = "dissolve" | "delete-all"

export function DeleteFolderDialog({ state, onOpenChange }: DeleteFolderDialogProps) {
  const { removeFolder } = useRSSStore()
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("dissolve")
  const [showConfirmation, setShowConfirmation] = useState(false)

  const handleClose = () => {
    onOpenChange(false)
    setShowConfirmation(false)
    setDeleteMode("dissolve")
  }

  const handleNext = () => {
    setShowConfirmation(true)
  }

  const handleConfirm = () => {
    const deleteFeeds = deleteMode === "delete-all"
    removeFolder(state.folderId, deleteFeeds)
    handleClose()
  }

  const getModeDescription = () => {
    if (deleteMode === "dissolve") {
      return `Folder "${state.folderName}" will be deleted, but its ${state.feedCount} feed(s) will be kept and moved to "No Folder".`
    } else {
      return `Folder "${state.folderName}" and all its ${state.feedCount} feed(s) will be permanently deleted. This cannot be undone.`
    }
  }

  return (
    <AlertDialog open={state.open} onOpenChange={handleClose}>
      <AlertDialogContent>
        {!showConfirmation ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Folder</AlertDialogTitle>
              <AlertDialogDescription>
                How would you like to handle the feeds in "{state.folderName}"?
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
                  <div className="font-medium">Keep feeds (Dissolve folder)</div>
                  <p className="text-sm text-muted-foreground">
                    Delete only the folder, keep all feeds and move them to "No Folder"
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
                  <div className="font-medium text-destructive">Delete all feeds</div>
                  <p className="text-sm text-muted-foreground">
                    Delete the folder and all {state.feedCount} feed(s) inside it permanently
                  </p>
                </div>
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleNext}>Next</AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
              <AlertDialogDescription>{getModeDescription()}</AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setShowConfirmation(false)}>Back</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                className={deleteMode === "delete-all" ? "bg-destructive hover:bg-destructive/90" : ""}
              >
                {deleteMode === "delete-all" ? "Delete All" : "Delete Folder"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}