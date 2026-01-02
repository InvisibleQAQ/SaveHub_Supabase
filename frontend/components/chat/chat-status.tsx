"use client"

import { Loader2 } from "lucide-react"

interface ChatStatusProps {
  status: string
}

export function ChatStatus({ status }: ChatStatusProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span>{status}</span>
    </div>
  )
}
