"use client"

import { useMemo } from "react"
import { Star, ExternalLink } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Repository } from "@/lib/types"
import { renderMarkdown } from "@/lib/markdown-renderer"

interface RepositoryDetailDialogProps {
  repository: Repository | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepositoryDetailDialog({
  repository,
  open,
  onOpenChange,
}: RepositoryDetailDialogProps) {
  if (!repository) return null

  // Render markdown to sanitized HTML
  const renderedContent = useMemo(() => {
    if (!repository.readmeContent) return null
    const baseUrl = `https://raw.githubusercontent.com/${repository.fullName}/main`
    return renderMarkdown(repository.readmeContent, { baseUrl })
  }, [repository.readmeContent, repository.fullName])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[90vh] max-h-[90vh] flex flex-col p-0 gap-0"
        style={{ width: '75vw', maxWidth: '75vw' }}
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-3">
            {repository.ownerAvatarUrl && (
              <img
                src={repository.ownerAvatarUrl}
                alt={repository.ownerLogin}
                className="w-8 h-8 rounded-full flex-shrink-0"
              />
            )}
            <span className="truncate">{repository.fullName}</span>
            <a
              href={repository.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </DialogTitle>
          {repository.description && (
            <p className="text-sm text-muted-foreground mt-1">
              {repository.description}
            </p>
          )}
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
            {repository.language && (
              <span>{repository.language}</span>
            )}
            <span className="flex items-center gap-1">
              <Star className="w-4 h-4 text-amber-500" />
              {repository.stargazersCount.toLocaleString()}
            </span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {renderedContent ? (
            <>
              {renderedContent.error && (
                <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  渲染失败: {renderedContent.error}
                </div>
              )}
              <article
                className="prose prose-sm dark:prose-invert max-w-none pb-4"
                dangerouslySetInnerHTML={{ __html: renderedContent.html }}
              />
            </>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              该仓库没有 README 文件
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
