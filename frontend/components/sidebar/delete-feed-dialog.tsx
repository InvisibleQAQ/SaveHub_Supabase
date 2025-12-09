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
import type { DeleteFeedDialogState } from "./types"
import { Loader2 } from "lucide-react"

interface DeleteFeedDialogProps {
  state: DeleteFeedDialogState
  onOpenChange: (open: boolean) => void
}

export function DeleteFeedDialog({ state, onOpenChange }: DeleteFeedDialogProps) {
  const { removeFeed } = useRSSStore()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClose = () => {
    // Don't allow closing while deletion is in progress
    if (isPending) return

    // Reset error when closing
    setError(null)
    onOpenChange(false)
  }

  const handleConfirm = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault() // Prevent AlertDialogAction from auto-closing dialog
    setIsPending(true)
    setError(null)

    try {
      const result = await removeFeed(state.feedId)

      if (result.success) {
        // Only close dialog if deletion succeeded
        onOpenChange(false)
      } else {
        // Show error if deletion failed
        setError(result.error || 'Failed to delete feed')
      }
    } catch (err) {
      // Handle unexpected errors
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <AlertDialog open={state.open} onOpenChange={handleClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Feed</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{state.feedTitle}"? This action cannot be undone.
            {error && (
              <span className="block mt-2 text-destructive font-medium">
                Error: {error}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isPending}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete Feed'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}