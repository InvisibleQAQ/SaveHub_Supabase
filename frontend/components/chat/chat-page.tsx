"use client"

import { useState, useRef, useEffect } from "react"
import { MessageSquare, Sparkles } from "lucide-react"
import {
  Conversation,
  ConversationContent,
  PromptInput,
  PromptInputStop,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements"
import { ChatMessage } from "./chat-message"
import {
  ChatStatus,
  type AgentStageLogEntry,
  type AgentStageLogStage,
  type AgentStageProgress,
} from "./chat-status"
import {
  agenticRagApi,
  type ChatMessage as Message,
  type AgenticStreamEvent,
  type RetrievedSource,
} from "@/lib/api/agentic-rag"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const QUICK_PROMPTS = [
  "最近收藏的仓库里，最值得关注的 3 个项目是什么？",
  "帮我总结今天新增文章的核心观点",
  "基于我的收藏内容，给出下周学习计划",
]

interface ChatState {
  messages: Message[]
  isLoading: boolean
  currentStatus: string | null
  messageSources: RetrievedSource[][]
  stages: AgentStageProgress
  stageLogs: AgentStageLogEntry[]
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

function appendStageLog(
  logs: AgentStageLogEntry[],
  message: string,
  stage: AgentStageLogStage = "system"
): AgentStageLogEntry[] {
  return [
    ...logs,
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      stage,
      message,
      timestamp: Date.now(),
    },
  ]
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function formatQuestionIndex(value: unknown): number {
  return toNumber(value, 0) + 1
}

function stageKeyFromProgress(stage?: string): keyof AgentStageProgress | null {
  if (!stage) return null

  if (stage === "rewrite") return "rewrite"
  if (stage === "toolCall" || stage === "tool_call") return "toolCall"
  if (stage === "expandContext" || stage === "expand_context") return "expandContext"
  if (stage === "aggregation") return "aggregation"

  return null
}

function stageFromToolName(toolName?: string): AgentStageLogStage {
  return toolName === "expand_context" ? "expandContext" : "toolCall"
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
            case "progress": {
              const progressText = event.data.display_text || event.data.message || "思考中..."
              const stageKey = stageKeyFromProgress(event.data.stage)
              const logStage = (stageKey ?? "system") as AgentStageLogStage

              setState((prev) => ({
                ...prev,
                currentStatus: progressText,
                stages: stageKey
                  ? {
                      ...prev.stages,
                      [stageKey]: prev.stages[stageKey] === "completed" ? "completed" : "active",
                    }
                  : prev.stages,
                stageLogs: appendStageLog(prev.stageLogs, progressText, logStage),
              }))
              break
            }

            case "rewrite": {
              const rewrittenCount = event.data.count ?? event.data.rewritten_queries.length
              const rewriteLog =
                event.data.display_text || `重写完成，拆分 ${rewrittenCount} 个子问题`

              setState((prev) => ({
                ...prev,
                currentStatus: rewriteLog,
                stages: {
                  ...prev.stages,
                  rewrite: "completed",
                  toolCall: "active",
                },
                stageLogs: appendStageLog(prev.stageLogs, rewriteLog, "rewrite"),
              }))
              break
            }

            case "tool_call": {
              const isExpandContext = event.data.tool_name === "expand_context"
              const defaultToolCallText = isExpandContext
                ? `第 ${formatQuestionIndex(event.data.question_index)} 个子问题进入二次检索`
                : `正在检索第 ${formatQuestionIndex(event.data.question_index)} 个子问题`
              const toolCallText = event.data.display_text || defaultToolCallText

              setState((prev) => ({
                ...prev,
                currentStatus: toolCallText,
                stages: {
                  ...prev.stages,
                  toolCall: isExpandContext ? "completed" : "active",
                  expandContext: isExpandContext ? "active" : prev.stages.expandContext,
                },
                stageLogs: appendStageLog(
                  prev.stageLogs,
                  toolCallText,
                  stageFromToolName(event.data.tool_name)
                ),
              }))
              break
            }

            case "tool_result": {
              const eventSources = event.data.sources || []
              sources = mergeSources(sources, eventSources)

              const fallbackResultText =
                event.data.tool_name === "expand_context"
                  ? `第 ${formatQuestionIndex(event.data.question_index)} 个子问题二次检索返回 ${toNumber(event.data.result_count)} 条结果`
                  : `第 ${formatQuestionIndex(event.data.question_index)} 个子问题检索返回 ${toNumber(event.data.result_count)} 条结果`
              const toolResultText = event.data.display_text || fallbackResultText

              setState((prev) => ({
                ...prev,
                currentStatus: toolResultText,
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
                  toolResultText,
                  stageFromToolName(event.data.tool_name)
                ),
              }))
              break
            }

            case "aggregation": {
              const aggregationText =
                event.data.display_text ||
                `已完成 ${event.data.completed}/${event.data.total_questions} 个子问题，正在聚合答案`

              setState((prev) => ({
                ...prev,
                currentStatus: aggregationText,
                stages: {
                  ...prev.stages,
                  aggregation: "active",
                },
                stageLogs: appendStageLog(prev.stageLogs, aggregationText, "aggregation"),
              }))
              break
            }

            case "clarification_required": {
              const clarificationMessage = event.data.message || "请补充更多问题细节。"
              const clarificationStatus =
                event.data.display_text || "需要补充问题细节后才能继续检索"

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
                stageLogs: appendStageLog(prev.stageLogs, clarificationStatus, "system"),
              }))

              abortRef.current?.abort()
              break
            }

            case "content":
              assistantContent += event.data.delta

              const contentStatus =
                event.data.display_text || "证据准备完成，正在生成最终回答"
              setState((prev) => ({
                ...prev,
                currentStatus: contentStatus,
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
              const doneLog = event.data.display_text || "回答完成"

              setState((prev) => ({
                ...prev,
                isLoading: false,
                currentStatus: null,
                messageSources:
                  prev.messages.length > 0 && prev.messages[prev.messages.length - 1]?.role === "assistant"
                    ? [...prev.messageSources.slice(0, -1), sources]
                    : prev.messageSources,
                clarificationPrompt:
                  event.data.message === "clarification_required"
                    ? prev.clarificationPrompt
                    : null,
                stages: {
                  rewrite: "completed",
                  toolCall: "completed",
                  expandContext:
                    prev.stages.expandContext === "active"
                      ? "completed"
                      : prev.stages.expandContext,
                  aggregation: "completed",
                },
                stageLogs:
                  event.data.message === "completed"
                    ? appendStageLog(prev.stageLogs, doneLog, "aggregation")
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

  const handleStop = () => {
    abortRef.current?.abort()
    setState((prev) => ({
      ...prev,
      isLoading: false,
      currentStatus: null,
    }))
  }

  const statusText = state.currentStatus || (state.stageLogs.length > 0 ? "回答完成，可展开查看流程" : null)
  const shouldShowStatus = Boolean(statusText)
  const lastMessageIndex = state.messages.length - 1
  const statusBeforeAssistantIndex =
    shouldShowStatus &&
    lastMessageIndex >= 0 &&
    state.messages[lastMessageIndex]?.role === "assistant"
      ? lastMessageIndex
      : -1

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-b from-background to-muted/20">
      {/* Header */}
      <div className="border-b border-border/70 bg-background/80 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-2 text-primary shadow-sm">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="font-semibold">智能问答</h1>
            <p className="text-sm text-muted-foreground">
              基于您的文章和仓库进行问答
            </p>
          </div>
          <span className="hidden rounded-full border border-border/70 bg-card/70 px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">
            Agentic RAG
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
              state.isLoading
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            )}
          >
            {state.isLoading ? "Streaming" : "Ready"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <Conversation className="px-6">
        <ConversationContent>
          {state.messages.length === 0 ? (
            <div className="py-10">
              <div className="mx-auto max-w-2xl rounded-2xl border border-border/70 bg-card/80 p-6 text-center shadow-sm">
                <MessageSquare className="w-12 h-12 mx-auto text-primary/70 mb-4" />
                <h2 className="text-lg font-semibold mb-2">开始对话</h2>
                <p className="text-sm text-muted-foreground">
                输入问题，我会从您的文章和仓库中检索相关信息来回答
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full border-border/70 bg-background/60"
                      onClick={() => setInput(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            state.messages.map((msg, i) => (
              <div key={i}>
                {statusBeforeAssistantIndex === i && statusText && (
                  <div className="pt-1">
                    <ChatStatus
                      status={statusText}
                      stages={state.stages}
                      stageLogs={state.stageLogs}
                      defaultCollapsed={!state.isLoading}
                      isRunning={state.isLoading}
                    />
                  </div>
                )}
                <ChatMessage
                  message={msg}
                  sources={msg.role === "assistant" ? state.messageSources[i] : undefined}
                />
              </div>
            ))
          )}
          {shouldShowStatus && statusBeforeAssistantIndex === -1 && statusText && (
            <div className="pt-1">
              <ChatStatus
                status={statusText}
                stages={state.stages}
                stageLogs={state.stageLogs}
                defaultCollapsed={!state.isLoading}
                isRunning={state.isLoading}
              />
            </div>
          )}
          {state.error && (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive shadow-sm">
              {state.error}
            </div>
          )}
          <div ref={scrollRef} />
        </ConversationContent>
      </Conversation>

      {/* Input */}
      <PromptInput>
        <div className="mx-auto flex w-full max-w-3xl items-end gap-3">
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              state.clarificationPrompt
                ? "请先补充上方澄清问题的细节..."
                : "输入您的问题..."
            }
            disabled={state.isLoading}
          />
          {state.isLoading && (
            <PromptInputStop onClick={handleStop}>
              停止生成
            </PromptInputStop>
          )}
          <PromptInputSubmit
            onClick={handleSubmit}
            disabled={!input.trim() || state.isLoading}
            isLoading={state.isLoading}
          />
        </div>
      </PromptInput>
    </div>
  )
}
