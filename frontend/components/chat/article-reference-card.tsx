"use client"

import { FileText, ExternalLink } from "lucide-react"
import type { RetrievedSource } from "@/lib/api/agentic-rag"

interface ArticleReferenceCardProps {
  source: RetrievedSource
}

export function ArticleReferenceCard({ source }: ArticleReferenceCardProps) {
  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex-shrink-0">
          <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm line-clamp-2">{source.title}</h4>
          <p className="text-xs text-muted-foreground mt-1">
            相关度: {(source.score * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Content Preview */}
      <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
        {source.content}
      </p>

      {/* Link */}
      {source.url && (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          查看原文
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  )
}
