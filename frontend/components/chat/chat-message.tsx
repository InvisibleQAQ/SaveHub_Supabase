"use client"

import { useMemo, useState } from "react"
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ai-elements/message"
import { Response } from "@/components/ai-elements/response"
import { ChatSources } from "./chat-sources"
import { ArticleReferenceCard } from "./article-reference-card"
import { getCircledNumber } from "@/lib/reference-parser"
import type { ChatMessage as ChatMessageData, RetrievedSource } from "@/lib/api/agentic-rag"
import { useRSSStore } from "@/lib/store"
import { RepositoryCard } from "@/components/repository/repository-card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ChatMessageProps {
  message: ChatMessageData
  sources?: RetrievedSource[]
}

function formatMessageContent(content: string, sources?: RetrievedSource[]): string {
  if (!sources || sources.length === 0) return content

  const sourceMap = new Map<number, RetrievedSource>()
  sources.forEach((source) => sourceMap.set(source.index, source))

  const escapeHtmlAttribute = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")

  return content.replace(/\[ref:(\d+)\]/g, (match, rawIndex) => {
    const index = Number.parseInt(rawIndex, 10)
    const source = sourceMap.get(index)

    if (Number.isNaN(index) || !source) {
      return match
    }

    const label = getCircledNumber(index)

    if (!source.url) {
      return `<a href="#" data-reference-index="${index}" class="inline-flex items-center justify-center w-5 h-5 text-xs font-medium rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors align-super ml-0.5 no-underline" title="查看来源：${escapeHtmlAttribute(source.title)}">${label}</a>`
    }

    return `<a href="${escapeHtmlAttribute(source.url)}" data-reference-index="${index}" class="inline-flex items-center justify-center w-5 h-5 text-xs font-medium rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors align-super ml-0.5 no-underline" title="查看来源：${escapeHtmlAttribute(source.title)}">${label}</a>`
  })
}

export function ChatMessage({ message, sources }: ChatMessageProps) {
  const isUser = message.role === "user"
  const from = isUser ? "user" : "assistant"
  const repositories = useRSSStore((state) => state.repositories)
  const [activeSource, setActiveSource] = useState<RetrievedSource | null>(null)
  const content = formatMessageContent(message.content, sources)

  const userMarkdownClassName =
    "prose-headings:text-primary-foreground prose-p:text-primary-foreground prose-strong:text-primary-foreground prose-em:text-primary-foreground prose-li:text-primary-foreground prose-code:text-primary-foreground prose-pre:border-primary-foreground/20 prose-pre:bg-primary-foreground/10 prose-blockquote:text-primary-foreground prose-a:text-primary-foreground prose-th:text-primary-foreground prose-td:text-primary-foreground"

  const activeRepository = useMemo(() => {
    if (!activeSource?.repository_id) return null
    return repositories.find((repo) => repo.id === activeSource.repository_id) || null
  }, [activeSource?.repository_id, repositories])

  const handleMessageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!sources || sources.length === 0) return

    const target = event.target as HTMLElement
    const referenceAnchor = target.closest("a[data-reference-index]") as HTMLAnchorElement | null
    if (!referenceAnchor) return

    const rawIndex = referenceAnchor.dataset.referenceIndex
    const referenceIndex = Number.parseInt(rawIndex || "", 10)
    if (Number.isNaN(referenceIndex)) return

    const source = sources.find((item) => item.index === referenceIndex)
    if (!source) return

    event.preventDefault()
    event.stopPropagation()
    setActiveSource(source)
  }

  const closeReferenceDialog = () => {
    setActiveSource(null)
  }

  return (
    <>
      <Message from={from}>
        <MessageAvatar from={from} />
        <MessageContent from={from} onClick={!isUser ? handleMessageClick : undefined}>
          <Response className={isUser ? userMarkdownClassName : undefined}>{content}</Response>
          {!isUser && sources && <ChatSources sources={sources} />}
        </MessageContent>
      </Message>

      {!isUser && activeSource && (
        <Dialog open={Boolean(activeSource)} onOpenChange={(open) => (!open ? closeReferenceDialog() : undefined)}>
          <DialogContent className="max-w-2xl p-0 gap-0" showCloseButton>
            <DialogHeader className="px-4 pt-4 pb-2 border-b">
              <DialogTitle className="text-base">引用来源</DialogTitle>
            </DialogHeader>
            <div className="p-4 max-h-[75vh] overflow-y-auto">
              {activeRepository ? (
                <RepositoryCard repository={activeRepository} />
              ) : (
                <ArticleReferenceCard source={activeSource} />
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
