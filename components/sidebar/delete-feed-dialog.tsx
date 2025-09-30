"use client"

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
import type { DeleteFeedDialogState } from "./types"

interface DeleteFeedDialogProps {
  state: DeleteFeedDialogState
  onOpenChange: (open: boolean) => void
}

export function DeleteFeedDialog({ state, onOpenChange }: DeleteFeedDialogProps) {
  const { removeFeed } = useRSSStore()

  const handleClose = () => {
    onOpenChange(false)
  }

  const handleConfirm = () => {
    removeFeed(state.feedId)
    handleClose()
  }

  return (
    <AlertDialog open={state.open} onOpenChange={handleClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Feed</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{state.feedTitle}"? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} className="bg-destructive hover:bg-destructive/90">
            Delete Feed
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}