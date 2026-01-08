/**
 * RAG Chat API 客户端
 *
 * 处理 SSE 流式响应
 */

import { fetchWithAuth, isTokenExpiringSoon, proactiveRefresh } from "./fetch-client"

const API_BASE = "/api/backend/rag-chat"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface RetrievedSource {
  id: string
  index: number // 来源索引，从1开始，用于引用标记
  content: string
  score: number
  source_type: "article" | "repository"
  title: string
  url?: string
  // Repository 专用字段（用于引用卡片显示）
  owner_login?: string
  owner_avatar_url?: string
  stargazers_count?: number
  language?: string
  description?: string
}

export type StreamEventType =
  | "decision"
  | "retrieval"
  | "content"
  | "assessment"
  | "done"
  | "error"

export interface StreamEvent {
  event: StreamEventType
  data: Record<string, unknown>
}

export interface RagChatRequest {
  messages: ChatMessage[]
  top_k?: number
  min_score?: number
}

export const ragChatApi = {
  /**
   * 流式问答
   */
  async streamChat(
    messages: ChatMessage[],
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    // Proactive refresh before SSE long-running request
    if (isTokenExpiringSoon()) {
      const refreshed = await proactiveRefresh()
      if (!refreshed) {
        throw new Error("Session expired")
      }
    }

    const response = await fetchWithAuth(`${API_BASE}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Request failed: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response body")

    const decoder = new TextDecoder()
    let buffer = ""
    let currentEvent = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent({ event: currentEvent as StreamEventType, data })
          } catch (e) {
            console.error("Failed to parse SSE data:", e)
          }
        }
      }
    }
  },
}
