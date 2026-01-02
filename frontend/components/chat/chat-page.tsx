"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Loader2, MessageSquare, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage } from "./chat-message"
import { ChatStatus } from "./chat-status"
import {
  ragChatApi,
  type ChatMessage as Message,
  type StreamEvent,
  type RetrievedSource,
} from "@/lib/api/rag-chat"

interface ChatState {
  messages: Message[]
  isLoading: boolean
  currentStatus: string | null
  currentSources: RetrievedSource[]
  error: string | null
}

export function ChatPage() {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false,
    currentStatus: null,
    currentSources: [],
    error: null,
  })
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [state.messages])

  const handleSubmit = async () => {
    if (!input.trim() || state.isLoading) return

    const userMessage: Message = { role: "user", content: input.trim() }
    const newMessages = [...state.messages, userMessage]

    setState((prev) => ({
      ...prev,
      messages: newMessages,
      isLoading: true,
      currentStatus: "思考中...",
      currentSources: [],
      error: null,
    }))
    setInput("")

    abortRef.current = new AbortController()

    try {
      let assistantContent = ""
      let sources: RetrievedSource[] = []

      await ragChatApi.streamChat(
        newMessages,
        (event: StreamEvent) => {
          switch (event.event) {
            case "decision":
              setState((prev) => ({
                ...prev,
                currentStatus: event.data.needs_retrieval
                  ? "正在检索相关内容..."
                  : "直接回答...",
              }))
              break

            case "retrieval":
              sources = (event.data.sources as RetrievedSource[]) || []
              setState((prev) => ({
                ...prev,
                currentStatus: `找到 ${event.data.total} 条相关内容`,
                currentSources: sources,
              }))
              break

            case "content":
              assistantContent += event.data.delta as string
              setState((prev) => ({
                ...prev,
                currentStatus: "生成回答中...",
                messages: [
                  ...newMessages,
                  { role: "assistant", content: assistantContent },
                ],
              }))
              break

            case "assessment":
              setState((prev) => ({
                ...prev,
                currentStatus: null,
              }))
              break

            case "done":
              setState((prev) => ({
                ...prev,
                isLoading: false,
                currentStatus: null,
              }))
              break

            case "error":
              throw new Error(event.data.message as string)
          }
        },
        abortRef.current.signal
      )
    } catch (error) {
      if ((error as Error).name === "AbortError") return

      setState((prev) => ({
        ...prev,
        isLoading: false,
        currentStatus: null,
        error: (error as Error).message,
      }))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
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
          {state.messages.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <h2 className="text-lg font-medium mb-2">开始对话</h2>
              <p className="text-sm text-muted-foreground">
                输入问题，我会从您的文章和仓库中检索相关信息来回答
              </p>
            </div>
          ) : (
            state.messages.map((msg, i) => (
              <ChatMessage
                key={i}
                message={msg}
                sources={msg.role === "assistant" ? state.currentSources : undefined}
              />
            ))
          )}
          {state.currentStatus && <ChatStatus status={state.currentStatus} />}
          {state.error && (
            <div className="p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
              {state.error}
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
            disabled={state.isLoading}
          />
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || state.isLoading}
            size="icon"
            className="h-[60px] w-[60px]"
          >
            {state.isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}