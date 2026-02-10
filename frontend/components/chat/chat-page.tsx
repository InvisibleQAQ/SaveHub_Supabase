"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Loader2, MessageSquare, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage } from "./chat-message"
import { ChatStatus, type AgentStageProgress } from "./chat-status"
import {
  agenticRagApi,
  type ChatMessage as Message,
  type AgenticStreamEvent,
  type RetrievedSource,
} from "@/lib/api/agentic-rag"

interface ChatState {
  messages: Message[]
  isLoading: boolean
  currentStatus: string | null
  currentSources: RetrievedSource[]
  messageSources: RetrievedSource[][]
  stages: AgentStageProgress
  stageLogs: string[]
  clarificationPrompt: string | null
  error: string | null
}

function initialStages(): AgentStageProgress {
  return {
    rewrite: "pending",
    toolCall: "pending",
    expandContext: "pending",
    aggregation: "pending",
  }
}

function appendStageLog(logs: string[], log: string): string[] {
  return [...logs, log].slice(-5)
}

function mergeSources(
  existing: RetrievedSource[],
  incoming: RetrievedSource[]
): RetrievedSource[] {
  const sourceMap = new Map<string, RetrievedSource>()

  for (const source of existing) {
    sourceMap.set(source.id, source)
  }

  for (const source of incoming) {
    sourceMap.set(source.id, source)
  }

  return Array.from(sourceMap.values()).sort((a, b) => a.index - b.index)
}

export function ChatPage() {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false,
    currentStatus: null,
    currentSources: [],
    messageSources: [],
    stages: initialStages(),
    stageLogs: [],
    clarificationPrompt: null,
    error: null,
  })
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [state.messages])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const handleSubmit = async () => {
    if (!input.trim() || state.isLoading) return

    const userMessage: Message = { role: "user", content: input.trim() }
    const newMessages = [...state.messages, userMessage]
    const newMessageSources = [...state.messageSources, []]

    setState((prev) => ({
      ...prev,
      messages: newMessages,
      messageSources: newMessageSources,
      isLoading: true,
      currentStatus: "思考中...",
      currentSources: [],
      stages: initialStages(),
      stageLogs: [],
      clarificationPrompt: null,
      error: null,
    }))
    setInput("")

    abortRef.current = new AbortController()

    try {
      let assistantContent = ""
      let sources: RetrievedSource[] = []

      await agenticRagApi.streamChat(
        newMessages,
        (event: AgenticStreamEvent) => {
          switch (event.event) {
            case "rewrite": {
              const rewrittenCount = event.data.count ?? event.data.rewritten_queries.length

              setState((prev) => ({
                ...prev,
                currentStatus: "正在重写与拆分问题...",
                stages: {
                  ...prev.stages,
                  rewrite: "completed",
                  toolCall: "active",
                },
                stageLogs: appendStageLog(
                  prev.stageLogs,
                  `重写完成，拆分 ${rewrittenCount} 个子问题`
                ),
              }))
              break
            }

            case "tool_call": {
              const isExpandContext = event.data.tool_name === "expand_context"

              setState((prev) => ({
                ...prev,
                currentStatus: isExpandContext
                  ? "正在进行二次检索..."
                  : "正在调用检索工具...",
                stages: {
                  ...prev.stages,
                  toolCall: isExpandContext ? "completed" : "active",
                  expandContext: isExpandContext ? "active" : prev.stages.expandContext,
                },
                stageLogs: appendStageLog(
                  prev.stageLogs,
                  `调用工具：${event.data.tool_name}`
                ),
              }))
              break
            }

            case "tool_result": {
              const eventSources = event.data.sources || []
              sources = mergeSources(sources, eventSources)

              setState((prev) => ({
                ...prev,
                currentStatus: "已获取检索结果，分析中...",
                currentSources: sources,
                stages: {
                  ...prev.stages,
                  toolCall:
                    event.data.tool_name === "search_embeddings"
                      ? "completed"
                      : prev.stages.toolCall,
                  expandContext:
                    event.data.tool_name === "expand_context"
                      ? "completed"
                      : prev.stages.expandContext,
                },
                stageLogs: appendStageLog(
                  prev.stageLogs,
                  `${event.data.tool_name} 返回 ${event.data.result_count} 条结果`
                ),
              }))
              break
            }

            case "aggregation": {
              setState((prev) => ({
                ...prev,
                currentStatus: "正在聚合多问题答案...",
                stages: {
                  ...prev.stages,
                  aggregation: "active",
                },
                stageLogs: appendStageLog(
                  prev.stageLogs,
                  `聚合进度 ${event.data.completed}/${event.data.total_questions}`
                ),
              }))
              break
            }

            case "clarification_required": {
              const clarificationMessage = event.data.message || "请补充更多问题细节。"

              setState((prev) => ({
                ...prev,
                messages: [...prev.messages, { role: "assistant", content: clarificationMessage }],
                isLoading: false,
                currentStatus: null,
                clarificationPrompt: clarificationMessage,
                stages: {
                  ...prev.stages,
                  rewrite: prev.stages.rewrite === "pending" ? "completed" : prev.stages.rewrite,
                  toolCall: prev.stages.toolCall === "active" ? "completed" : prev.stages.toolCall,
                  expandContext:
                    prev.stages.expandContext === "active"
                      ? "completed"
                      : prev.stages.expandContext,
                  aggregation:
                    prev.stages.aggregation === "active" ? "completed" : prev.stages.aggregation,
                },
                stageLogs: appendStageLog(prev.stageLogs, "需要你补充信息后继续"),
              }))

              abortRef.current?.abort()
              break
            }

            case "content":
              assistantContent += event.data.delta
              setState((prev) => ({
                ...prev,
                currentStatus: "生成回答中...",
                stages: {
                  ...prev.stages,
                  rewrite: prev.stages.rewrite === "pending" ? "completed" : prev.stages.rewrite,
                  toolCall: prev.stages.toolCall === "active" ? "completed" : prev.stages.toolCall,
                  expandContext:
                    prev.stages.expandContext === "active"
                      ? "completed"
                      : prev.stages.expandContext,
                  aggregation:
                    prev.stages.aggregation === "active" ? "completed" : prev.stages.aggregation,
                },
                messages: [
                  ...newMessages,
                  { role: "assistant", content: assistantContent },
                ],
                messageSources: [...newMessageSources, sources],
              }))
              break

            case "done": {
              sources = mergeSources(sources, event.data.sources || [])

              setState((prev) => ({
                ...prev,
                isLoading: false,
                currentStatus: null,
                currentSources: sources,
                messageSources:
                  prev.messages.length > 0 && prev.messages[prev.messages.length - 1]?.role === "assistant"
                    ? [...prev.messageSources.slice(0, -1), sources]
                    : prev.messageSources,
                clarificationPrompt:
                  event.data.message === "clarification_required"
                    ? prev.clarificationPrompt
                    : null,
                stages: {
                  rewrite: prev.stages.rewrite === "active" ? "completed" : prev.stages.rewrite,
                  toolCall: prev.stages.toolCall === "active" ? "completed" : prev.stages.toolCall,
                  expandContext:
                    prev.stages.expandContext === "active"
                      ? "completed"
                      : prev.stages.expandContext,
                  aggregation:
                    prev.stages.aggregation === "active" ? "completed" : prev.stages.aggregation,
                },
                stageLogs:
                  event.data.message === "completed"
                    ? appendStageLog(prev.stageLogs, "回答完成")
                    : prev.stageLogs,
              }))
              break
            }

            case "error":
              throw new Error(event.data.message)
          }
        },
        abortRef.current.signal
      )
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return
      }

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
                sources={msg.role === "assistant" ? state.messageSources[i] : undefined}
              />
            ))
          )}
          {state.currentStatus && (
            <ChatStatus
              status={state.currentStatus}
              stages={state.stages}
              stageLogs={state.stageLogs}
            />
          )}
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
            placeholder={
              state.clarificationPrompt
                ? "请先补充上方澄清问题的细节..."
                : "输入您的问题..."
            }
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
