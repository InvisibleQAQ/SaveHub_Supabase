"use client"

import { Star, ExternalLink, Clock } from "lucide-react"
import type { Repository } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { getLanguageColor } from "@/lib/language-colors"

interface RepositoryCardProps {
  repository: Repository
  onClick?: () => void
}

export function RepositoryCard({ repository, onClick }: RepositoryCardProps) {
  const updatedAt = repository.githubUpdatedAt
    ? formatDistanceToNow(new Date(repository.githubUpdatedAt), {
        addSuffix: true,
        locale: zhCN,
      })
    : null

  const languageColor = getLanguageColor(repository.language)

  return (
    <div
      className="group relative bg-card border rounded-xl p-4 transition-all duration-200 hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {repository.ownerAvatarUrl && (
          <img
            src={repository.ownerAvatarUrl}
            alt={repository.ownerLogin}
            className="w-10 h-10 rounded-full ring-2 ring-background shadow-sm"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={repository.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground hover:text-primary transition-colors truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {repository.fullName}
            </a>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
            {repository.description || "No description"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
        {repository.language && (
          <span className="flex items-center gap-1.5 font-medium">
            <span
              className="w-3 h-3 rounded-full shadow-sm"
              style={{ backgroundColor: languageColor }}
            />
            {repository.language}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-medium">{repository.stargazersCount.toLocaleString()}</span>
        </span>
        {updatedAt && (
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {updatedAt}
          </span>
        )}
      </div>

      {repository.topics && repository.topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {repository.topics.map((topic) => (
            <span
              key={topic}
              className="px-2 py-0.5 text-xs bg-primary/10 text-primary/80 rounded-md font-medium hover:bg-primary/20 transition-colors cursor-default"
            >
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
