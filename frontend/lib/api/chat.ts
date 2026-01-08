/**
 * Chat API 客户端
 *
 * 会话管理 + SSE 流式响应
 */

import { fetchWithAuth, isTokenExpiringSoon, proactiveRefresh } from "./fetch-client"
import type { RetrievedSource, StreamEvent, StreamEventType } from "./rag-chat"

const API_BASE = "/api/backend/chat"

// =============================================================================
// Types
// =============================================================================

export interface ChatSession {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  session_id: string
  role: "user" | "assistant"
  content: string
  sources?: RetrievedSource[]
  created_at: string
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

// =============================================================================
// API Client
// =============================================================================

export const chatApi = {
  // Session CRUD

  async listSessions(): Promise<ChatSession[]> {
    const res = await fetchWithAuth(`${API_BASE}/sessions`)
    if (!res.ok) throw new Error("Failed to list sessions")
    return res.json()
  },

  async createSession(id?: string, title?: string): Promise<ChatSession> {
    const res = await fetchWithAuth(`${API_BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: title || "New Chat" }),
    })
    if (!res.ok) throw new Error("Failed to create session")
    return res.json()
  },

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    const res = await fetchWithAuth(`${API_BASE}/sessions/${sessionId}`)
    if (!res.ok) throw new Error("Failed to get messages")
    return res.json()
  },

  async updateSession(sessionId: string, updates: { title?: string }): Promise<ChatSession> {
    const res = await fetchWithAuth(`${API_BASE}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error("Failed to update session")
    return res.json()
  },

  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetchWithAuth(`${API_BASE}/sessions/${sessionId}`, {
      method: "DELETE",
    })
    if (!res.ok) throw new Error("Failed to delete session")
  },

  // Streaming chat

  async streamChat(
    sessionId: string,
    messages: ChatMessage[],
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (isTokenExpiringSoon()) {
      const refreshed = await proactiveRefresh()
      if (!refreshed) throw new Error("Session expired")
    }

    const res = await fetchWithAuth(`${API_BASE}/sessions/${sessionId}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, messages }),
      signal,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(error.detail || `Request failed: ${res.status}`)
    }

    const reader = res.body?.getReader()
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
