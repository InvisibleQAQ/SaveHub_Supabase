"use client"

import { Star, ExternalLink } from "lucide-react"
import type { Repository } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"

interface RepositoryCardProps {
  repository: Repository
}

export function RepositoryCard({ repository }: RepositoryCardProps) {
  const updatedAt = repository.githubUpdatedAt
    ? formatDistanceToNow(new Date(repository.githubUpdatedAt), {
        addSuffix: true,
        locale: zhCN,
      })
    : null

  return (
    <div className="bg-card border rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {repository.ownerAvatarUrl && (
          <img
            src={repository.ownerAvatarUrl}
            alt={repository.ownerLogin}
            className="w-10 h-10 rounded-full"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={repository.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline truncate"
            >
              {repository.fullName}
            </a>
            <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          </div>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {repository.description || "No description"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
        {repository.language && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-primary" />
            {repository.language}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Star className="w-3 h-3" />
          {repository.stargazersCount.toLocaleString()}
        </span>
        {updatedAt && <span>{updatedAt}</span>}
      </div>

      {repository.topics && repository.topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {repository.topics.slice(0, 4).map((topic) => (
            <span
              key={topic}
              className="px-2 py-0.5 text-xs bg-muted rounded-full"
            >
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
