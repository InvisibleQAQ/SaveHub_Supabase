"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Star, ExternalLink } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Repository } from "@/lib/types"

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {repository.ownerAvatarUrl && (
              <img
                src={repository.ownerAvatarUrl}
                alt={repository.ownerLogin}
                className="w-8 h-8 rounded-full"
              />
            )}
            <span className="truncate">{repository.fullName}</span>
            <a
              href={repository.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary"
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

        <ScrollArea className="flex-1 mt-4 h-[60vh]">
          {repository.readmeContent ? (
            <article className="prose prose-sm dark:prose-invert max-w-none pr-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {repository.readmeContent}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              该仓库没有 README 文件
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
