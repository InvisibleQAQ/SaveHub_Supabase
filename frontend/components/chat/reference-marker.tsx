"use client"

import { useState } from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ArticleReferenceCard } from "./article-reference-card"
import { RepositoryReferenceCard } from "./repository-reference-card"
import type { RetrievedSource } from "@/lib/api/rag-chat"
import { getCircledNumber } from "@/lib/reference-parser"

interface ReferenceMarkerProps {
  index: number
  source: RetrievedSource
}

export function ReferenceMarker({ index, source }: ReferenceMarkerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center justify-center w-5 h-5 text-xs
                     font-medium rounded-full bg-primary/10 text-primary
                     hover:bg-primary/20 transition-colors cursor-pointer
                     align-super ml-0.5"
          onClick={() => setOpen(true)}
        >
          {getCircledNumber(index)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        side="top"
        sideOffset={8}
      >
        {source.source_type === "article" ? (
          <ArticleReferenceCard source={source} />
        ) : (
          <RepositoryReferenceCard source={source} />
        )}
      </PopoverContent>
    </Popover>
  )
}
