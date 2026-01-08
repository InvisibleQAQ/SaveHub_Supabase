"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Loader2, MessageSquare, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage } from "./chat-message"
import { ChatStatus } from "./chat-status"
import { ChatSidebar } from "./chat-sidebar"
import { useRSSStore } from "@/lib/store"
import { chatApi, type ChatMessage as ApiMessage } from "@/lib/api/chat"
import type { StreamEvent, RetrievedSource } from "@/lib/api/rag-chat"

export function ChatPage() {
  const {
    currentSessionId,
    currentMessages,
    currentSources,
    isChatLoading,
    addLocalMessage,
    updateLastMessageContent,
    setCurrentSources,
    refreshSessionInList,
    loadChatSessions,
  } = useRSSStore()

  const [input, setInput] = useState("")
  const [currentStatus, setCurrentStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load sessions on mount
  useEffect(() => {
    loadChatSessions()
  }, [loadChatSessions])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [currentMessages])

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming) return

    const userContent = input.trim()
    setInput("")
    setError(null)
    setCurrentStatus("思考中...")
    setIsStreaming(true)

    // Add user message locally
    addLocalMessage({
      session_id: currentSessionId || "",
      role: "user",
      content: userContent,
    })

    // Prepare messages for API
    const apiMessages: ApiMessage[] = [
      ...currentMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userContent },
    ]

    // Get or create session ID
    const sessionId = currentSessionId || crypto.randomUUID()

    abortRef.current = new AbortController()

    try {
      let assistantContent = ""
      let sources: RetrievedSource[] = []

      // Add placeholder for assistant message
      addLocalMessage({
        session_id: sessionId,
        role: "assistant",
        content: "",
      })

      await chatApi.streamChat(
        sessionId,
        apiMessages,
        (event: StreamEvent) => {
          switch (event.event) {
            case "decision":
              setCurrentStatus(
                event.data.needs_retrieval
                  ? "正在检索相关内容..."
                  : "直接回答..."
              )
              break

            case "retrieval":
              sources = (event.data.sources as RetrievedSource[]) || []
              setCurrentStatus(`找到 ${event.data.total} 条相关内容`)
              setCurrentSources(sources)
              break

            case "content":
              assistantContent += event.data.delta as string
              updateLastMessageContent(assistantContent)
              setCurrentStatus("生成回答中...")
              break

            case "assessment":
              setCurrentStatus(null)
              break

            case "done":
              setIsStreaming(false)
              setCurrentStatus(null)
              // Refresh session list to update title and order
              refreshSessionInList(sessionId)
              loadChatSessions()
              break

            case "error":
              throw new Error(event.data.message as string)
          }
        },
        abortRef.current.signal
      )
    } catch (err) {
      if ((err as Error).name === "AbortError") return

      setIsStreaming(false)
      setCurrentStatus(null)
      setError((err as Error).message)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Chat Sidebar */}
      <ChatSidebar />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-semibold">智能问答</h1>
          <p className="text-sm text-muted-foreground">
            基于您的文章和仓库进行问答
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6">
        <div className="max-w-3xl mx-auto py-6 space-y-6">
          {currentMessages.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <h2 className="text-lg font-medium mb-2">开始对话</h2>
              <p className="text-sm text-muted-foreground">
                输入问题，我会从您的文章和仓库中检索相关信息来回答
              </p>
            </div>
          ) : (
            currentMessages.map((msg, i) => (
              <ChatMessage
                key={msg.id || i}
                message={{ role: msg.role, content: msg.content }}
                sources={msg.role === "assistant" ? (msg.sources || currentSources) : undefined}
              />
            ))
          )}
          {currentStatus && <ChatStatus status={currentStatus} />}
          {error && (
            <div className="p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t px-6 py-4">
        <div className="max-w-3xl mx-auto flex gap-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入您的问题..."
            className="min-h-[60px] max-h-[200px] resize-none"
            disabled={isStreaming}
          />
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || isStreaming}
            size="icon"
            className="h-[60px] w-[60px]"
          >
            {isStreaming ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>
      </div>
    </div>
  )
}