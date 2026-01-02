"use client"

import { Star, ExternalLink } from "lucide-react"
import type { RetrievedSource } from "@/lib/api/rag-chat"
import { getLanguageColor } from "@/lib/language-colors"

interface RepositoryReferenceCardProps {
  source: RetrievedSource
}

export function RepositoryReferenceCard({ source }: RepositoryReferenceCardProps) {
  const languageColor = getLanguageColor(source.language || null)

  // 格式化数字
  const formatNumber = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  return (
    <div className="p-4">
      {/* Header - Avatar + Name */}
      <div className="flex items-center gap-3 mb-3">
        {source.owner_avatar_url && (
          <img
            src={source.owner_avatar_url}
            alt={source.owner_login || ""}
            className="w-8 h-8 rounded-full flex-shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm truncate">{source.title}</h4>
          <p className="text-xs text-muted-foreground truncate">
            {source.owner_login}
          </p>
        </div>
      </div>

      {/* Description */}
      {source.description && (
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {source.description}
        </p>
      )}

      {/* Stats Row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
        {source.language && (
          <span className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: languageColor }}
            />
            {source.language}
          </span>
        )}
        {source.stargazers_count != null && (
          <span className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-amber-500" />
            {formatNumber(source.stargazers_count)}
          </span>
        )}
      </div>

      {/* Link */}
      {source.url && (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          在 GitHub 查看
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  )
}
