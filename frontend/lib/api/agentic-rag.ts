/**
 * Agentic-RAG Chat API 客户端
 *
 * 处理 SSE v2 流式响应
 */

import { fetchWithAuth, isTokenExpiringSoon, proactiveRefresh } from "./fetch-client"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface RetrievedSource {
  id: string
  index: number
  content: string
  score: number
  source_type: "article" | "repository"
  title: string
  url?: string
  owner_login?: string
  owner_avatar_url?: string
  stargazers_count?: number
  language?: string
  description?: string
}

export type AgenticStreamEventType =
  | "progress"
  | "rewrite"
  | "clarification_required"
  | "tool_call"
  | "tool_result"
  | "aggregation"
  | "content"
  | "done"
  | "error"

export interface ProgressEventData {
  stage?: string
  message: string
  display_text?: string
}

export interface RewriteEventData {
  original_query: string
  rewritten_queries: string[]
  count: number
  display_text?: string
}

export interface ClarificationRequiredEventData {
  message: string
  display_text?: string
}

export interface ToolCallEventData {
  question_index: number
  tool_name: string
  args: Record<string, unknown>
  display_text?: string
}

export interface ToolResultEventData {
  question_index: number
  tool_name: string
  result_count: number
  sources: RetrievedSource[]
  display_text?: string
}

export interface AggregationEventData {
  total_questions: number
  completed: number
  display_text?: string
}

export interface ContentEventData {
  delta: string
  display_text?: string
}

export interface DoneEventData {
  message: string
  sources: RetrievedSource[]
  display_text?: string
}

export interface ErrorEventData {
  message: string
}

export type AgenticStreamEvent =
  | { event: "progress"; data: ProgressEventData }
  | { event: "rewrite"; data: RewriteEventData }
  | { event: "clarification_required"; data: ClarificationRequiredEventData }
  | { event: "tool_call"; data: ToolCallEventData }
  | { event: "tool_result"; data: ToolResultEventData }
  | { event: "aggregation"; data: AggregationEventData }
  | { event: "content"; data: ContentEventData }
  | { event: "done"; data: DoneEventData }
  | { event: "error"; data: ErrorEventData }

export interface AgenticRagRequestOptions {
  top_k?: number
  min_score?: number
  max_split_questions?: number
  max_tool_rounds_per_question?: number
  max_expand_calls_per_question?: number
  retry_tool_on_failure?: boolean
  max_tool_retry?: number
}

const STREAM_EVENT_TYPES: Record<AgenticStreamEventType, true> = {
  progress: true,
  rewrite: true,
  clarification_required: true,
  tool_call: true,
  tool_result: true,
  aggregation: true,
  content: true,
  done: true,
  error: true,
}

function isAgenticStreamEventType(value: string): value is AgenticStreamEventType {
  return value in STREAM_EVENT_TYPES
}

export const agenticRagApi = {
  async streamChat(
    messages: ChatMessage[],
    onEvent: (event: AgenticStreamEvent) => void,
    signal?: AbortSignal,
    options?: AgenticRagRequestOptions
  ): Promise<void> {
    if (isTokenExpiringSoon()) {
      const refreshed = await proactiveRefresh()
      if (!refreshed) {
        throw new Error("Session expired")
      }
    }

    const response = await fetchWithAuth(`${API_BASE}/api/agentic-rag/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({ messages, ...options }),
      signal,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Request failed: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error("No response body")
    }

    const decoder = new TextDecoder()
    let buffer = ""
    let currentEvent = ""
    let currentDataLines: string[] = []

    const flushEvent = () => {
      if (!currentEvent || currentDataLines.length === 0) {
        currentEvent = ""
        currentDataLines = []
        return
      }

      if (!isAgenticStreamEventType(currentEvent)) {
        currentEvent = ""
        currentDataLines = []
        return
      }

      try {
        const data = JSON.parse(currentDataLines.join("\n")) as AgenticStreamEvent["data"]
        onEvent({ event: currentEvent, data } as AgenticStreamEvent)
      } catch (error) {
        console.error("Failed to parse SSE data:", error)
      }

      currentEvent = ""
      currentDataLines = []
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        flushEvent()
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const rawLine of lines) {
        const line = rawLine.trimEnd()

        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim()
          continue
        }

        if (line.startsWith("data:")) {
          currentDataLines.push(line.slice(5).trimStart())
          continue
        }

        if (line === "") {
          flushEvent()
        }
      }
    }
  },
}
