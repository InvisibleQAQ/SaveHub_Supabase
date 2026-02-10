"use client"

import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ai-elements/message"
import { Response } from "@/components/ai-elements/response"
import { ChatSources } from "./chat-sources"
import { ReferencedContent } from "./referenced-content"
import type { ChatMessage as ChatMessageData, RetrievedSource } from "@/lib/api/agentic-rag"

interface ChatMessageProps {
  message: ChatMessageData
  sources?: RetrievedSource[]
}

export function ChatMessage({ message, sources }: ChatMessageProps) {
  const isUser = message.role === "user"
  const from = isUser ? "user" : "assistant"

  return (
    <Message from={from}>
      <MessageAvatar from={from} />
      <MessageContent from={from}>
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        ) : sources && sources.length > 0 ? (
          <ReferencedContent content={message.content} sources={sources} />
        ) : (
          <Response>{message.content}</Response>
        )}
        {!isUser && sources && <ChatSources sources={sources} />}
      </MessageContent>
    </Message>
  )
}
