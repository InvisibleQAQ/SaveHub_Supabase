"use client"

import { User, Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import { ChatSources } from "./chat-sources"
import { renderMarkdown } from "@/lib/markdown-renderer"
import type { ChatMessage as Message, RetrievedSource } from "@/lib/api/rag-chat"

interface ChatMessageProps {
  message: Message
  sources?: RetrievedSource[]
}

export function ChatMessage({ message, sources }: ChatMessageProps) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div
        className={cn(
          "flex-1 max-w-[80%] rounded-lg px-4 py-3",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content).html }}
          />
        )}
        {!isUser && sources && <ChatSources sources={sources} />}
      </div>
    </div>
  )
}
