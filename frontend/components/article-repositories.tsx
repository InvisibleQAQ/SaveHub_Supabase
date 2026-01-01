"use client"

import { useState, useEffect } from "react"
import { Github } from "lucide-react"
import type { Repository } from "@/lib/types"
import { getArticleRepositories } from "@/lib/api/articles"
import { RepositoryCard } from "./repository/repository-card"
import { RepositoryDetailDialog } from "./repository/repository-detail-dialog"

interface ArticleRepositoriesProps {
  articleId: string
}

export function ArticleRepositories({ articleId }: ArticleRepositoriesProps) {
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

  // Hide completely when loading or no repositories
  if (isLoading || repositories.length === 0) {
    return null
  }

  return (
    <>
      <div className="mt-8 pt-6 border-t border-border">
        {/* Section Title */}
        <div className="flex items-center gap-2 mb-4">
          <Github className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">相关 GitHub 仓库</h3>
          <span className="text-sm text-muted-foreground">
            ({repositories.length})
          </span>
        </div>

        {/* Repository Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {repositories.map((repo) => (
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
