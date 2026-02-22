"use client"

import { useState, useEffect } from "react"
import { Github } from "lucide-react"
import type { Repository } from "@/lib/types"
import { getArticleRepositories } from "@/lib/api/articles"
import { RepositoryCard } from "./repository/repository-card"
import { RepositoryDetailDialog } from "./repository/repository-detail-dialog"
import { useTranslations } from "next-intl"

interface ArticleRepositoriesProps {
  articleId: string
}

export function ArticleRepositories({ articleId }: ArticleRepositoriesProps) {
  const t = useTranslations("reader.repositories")
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function fetchRepositories() {
      setIsLoading(true)
      try {
        const repos = await getArticleRepositories(articleId)
        if (!cancelled) {
          setRepositories(repos)
        }
      } catch (error) {
        console.error("Failed to fetch article repositories:", error)
        if (!cancelled) {
          setRepositories([])
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchRepositories()

    return () => {
      cancelled = true
    }
  }, [articleId])

  const handleCardClick = (repo: Repository) => {
    setSelectedRepo(repo)
    setDetailOpen(true)
  }

  // No repositories after loading — hide entirely
  if (!isLoading && repositories.length === 0) {
    return null
  }

  return (
    <>
      <div className="mt-8 pt-6 border-t border-border">
        {/* Section Title */}
        <div className="flex items-center gap-2 mb-4">
          <Github className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">{t("relatedGithubRepositories")}</h3>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              ({repositories.length})
            </span>
          )}
        </div>

        {/* Repository Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isLoading
            ? Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-card border rounded-xl p-5 flex flex-col h-full animate-pulse"
                >
                  {/* Header skeleton */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-full bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded w-1/2" />
                      <div className="h-3 bg-muted rounded w-1/3" />
                    </div>
                  </div>
                  {/* Action buttons skeleton */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex gap-2">
                      <div className="w-8 h-8 bg-muted rounded-lg" />
                      <div className="w-8 h-8 bg-muted rounded-lg" />
                    </div>
                    <div className="flex gap-2">
                      <div className="w-8 h-8 bg-muted rounded-lg" />
                      <div className="w-8 h-8 bg-muted rounded-lg" />
                    </div>
                  </div>
                  {/* Description skeleton */}
                  <div className="mb-4 flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-full" />
                    <div className="h-3 bg-muted rounded w-5/6" />
                    <div className="h-3 bg-muted rounded w-2/3" />
                  </div>
                  {/* Tags skeleton */}
                  <div className="flex gap-1.5 mb-4">
                    <div className="h-5 bg-muted rounded-md w-14" />
                    <div className="h-5 bg-muted rounded-md w-16" />
                    <div className="h-5 bg-muted rounded-md w-12" />
                  </div>
                  {/* Stats skeleton */}
                  <div className="flex items-center gap-4 mt-auto">
                    <div className="h-3 bg-muted rounded w-16" />
                    <div className="h-3 bg-muted rounded w-12" />
                  </div>
                </div>
              ))
            : repositories.map((repo) => (
                <RepositoryCard
                  key={repo.id}
                  repository={repo}
                  onClick={() => handleCardClick(repo)}
                />
              ))}
        </div>
      </div>

      {/* Detail Dialog */}
      <RepositoryDetailDialog
        repository={selectedRepo}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
  )
}
