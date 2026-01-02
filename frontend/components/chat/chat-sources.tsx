"use client"

import { ExternalLink, FileText, Github } from "lucide-react"
import type { RetrievedSource } from "@/lib/api/rag-chat"

interface ChatSourcesProps {
  sources: RetrievedSource[]
}

export function ChatSources({ sources }: ChatSourcesProps) {
  if (!sources || sources.length === 0) return null

  return (
    <div className="mt-3 pt-3 border-t">
      <p className="text-xs text-muted-foreground mb-2">参考来源：</p>
      <div className="flex flex-wrap gap-2">
        {sources.map((source, i) => (
          <a
            key={source.id}
            href={source.url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80 transition-colors"
          >
            {source.source_type === "repository" ? (
              <Github className="w-3 h-3" />
            ) : (
              <FileText className="w-3 h-3" />
            )}
            <span className="max-w-[150px] truncate">{source.title}</span>
            {source.url && <ExternalLink className="w-3 h-3" />}
          </a>
        ))}
      </div>
    </div>
  )
}
