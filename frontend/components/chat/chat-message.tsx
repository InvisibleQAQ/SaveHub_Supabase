"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

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
  const activeSourceAnchorRef = useRef<HTMLAnchorElement | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const content = formatMessageContent(message.content, sources)

  const userMarkdownClassName =
    "prose-headings:text-primary-foreground prose-p:text-primary-foreground prose-strong:text-primary-foreground prose-em:text-primary-foreground prose-li:text-primary-foreground prose-code:text-primary-foreground prose-pre:border-primary-foreground/20 prose-pre:bg-primary-foreground/10 prose-blockquote:text-primary-foreground prose-a:text-primary-foreground prose-th:text-primary-foreground prose-td:text-primary-foreground"

  const activeRepository = useMemo(() => {
    if (!activeSource?.repository_id) return null
    return repositories.find((repo) => repo.id === activeSource.repository_id) || null
  }, [activeSource?.repository_id, repositories])

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const scheduleClose = (delayMs = 250) => {
    cancelClose()
    closeTimerRef.current = setTimeout(() => {
      setActiveSource(null)
      activeSourceAnchorRef.current = null
    }, delayMs)
  }

  const setReferencePreview = (source: RetrievedSource, anchor: HTMLAnchorElement) => {
    cancelClose()
    activeSourceAnchorRef.current = anchor
    setActiveSource(source)
  }

  const handleReferenceHover = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!sources || sources.length === 0) return

    const target = event.target as HTMLElement
    const referenceAnchor = target.closest("a[data-reference-index]") as HTMLAnchorElement | null
    if (!referenceAnchor) {
      scheduleClose()
      return
    }

    const rawIndex = referenceAnchor.dataset.referenceIndex
    const referenceIndex = Number.parseInt(rawIndex || "", 10)
    if (Number.isNaN(referenceIndex)) return

    const source = sources.find((item) => item.index === referenceIndex)
    if (!source) return

    if (activeSource?.id === source.id && activeSourceAnchorRef.current === referenceAnchor) {
      cancelClose()
      return
    }

    setReferencePreview(source, referenceAnchor)
  }

  const handleReferenceClick = (event: React.MouseEvent<HTMLDivElement>) => {
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

    if (activeSource?.id === source.id) {
      setActiveSource(null)
      activeSourceAnchorRef.current = null
      return
    }

    setReferencePreview(source, referenceAnchor)
  }

  useEffect(() => {
    return () => {
      cancelClose()
    }
  }, [])

  return (
    <>
      <Message from={from}>
        <MessageAvatar from={from} />
        <MessageContent
          from={from}
          onClick={!isUser ? handleReferenceClick : undefined}
          onMouseOver={!isUser ? handleReferenceHover : undefined}
          onMouseLeave={!isUser ? () => scheduleClose() : undefined}
        >
          <Response className={isUser ? userMarkdownClassName : undefined}>{content}</Response>
          {!isUser && sources && <ChatSources sources={sources} />}
        </MessageContent>
      </Message>

      {!isUser && (
        <Popover
          open={Boolean(activeSource)}
          onOpenChange={(open) => {
            if (!open) {
              setActiveSource(null)
              activeSourceAnchorRef.current = null
            }
          }}
        >
          <PopoverAnchor
            virtualRef={{
              current: {
                getBoundingClientRect: () => {
                  return activeSourceAnchorRef.current?.getBoundingClientRect() ?? new DOMRect()
                },
              },
            }}
          />
          {activeSource && (
            <PopoverContent
              side="top"
              align="center"
              sideOffset={12}
              className="w-[560px] max-w-[calc(100vw-1.5rem)] p-0 border-0 bg-transparent shadow-none rounded-xl"
              onMouseEnter={cancelClose}
              onMouseLeave={() => scheduleClose()}
            >
              <div className="max-h-[75vh] overflow-y-auto">
                {activeRepository ? (
                  <RepositoryCard repository={activeRepository} />
                ) : (
                  <div className="bg-card border rounded-xl">
                    <ArticleReferenceCard source={activeSource} />
                  </div>
                )}
              </div>
            </PopoverContent>
          )}
        </Popover>
      )}
    </>
  )
}
