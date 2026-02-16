import { fetchWithAuth, isTokenExpiringSoon, proactiveRefresh } from "./fetch-client"

// POST uses Next.js rewrite proxy (same-origin, no CORS issues)
const API_BASE = "/api/backend/transcripts"
// SSE stream uses direct backend URL (avoid Next.js rewrite buffering)
const STREAM_BASE = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/transcripts`

export interface TranscriptTask {
  task_id: string
  status: string
  stream_url?: string
}

export type TranscriptEventType =
  | "accepted"
  | "progress"
  | "result"
  | "done"
  | "error"
  | "heartbeat"

export interface TranscriptResultData {
  transcript_raw: string
  transcript_optimized: string
  summary: string
  translation: string
  video_title?: string
  [key: string]: any
}

export interface TranscriptEventData {
  task_id: string
  status: string
  stage?: string
  progress?: number
  message?: string
  result?: TranscriptResultData
  code?: string
  retryable?: boolean
  details?: any
  created_at?: string
  updated_at?: string
  completed_at?: string
  failed_at?: string
  server_time?: string
}

export interface TranscriptStreamEvent {
  event: TranscriptEventType
  data: TranscriptEventData
}

export const transcriptApi = {
  /**
   * Start a new transcription task
   */
  async startTask(url: string, language: string): Promise<TranscriptTask> {
    if (isTokenExpiringSoon()) {
      await proactiveRefresh()
    }

    const response = await fetchWithAuth(`${API_BASE}/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, summary_language: language }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Request failed: ${response.status}`)
    }

    return await response.json()
  },

  /**
   * Stream progress and results for a task via SSE
   */
  async streamTask(
    taskId: string,
    onEvent: (event: TranscriptStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    // Ensure auth is valid before starting stream
    if (isTokenExpiringSoon()) {
      const refreshed = await proactiveRefresh()
      if (!refreshed) {
        throw new Error("Session expired")
      }
    }

    const response = await fetchWithAuth(`${STREAM_BASE}/stream/${taskId}`, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      signal,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Stream failed: ${response.status}`)
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

      try {
        const dataStr = currentDataLines.join("\n")
        const data = JSON.parse(dataStr) as TranscriptEventData
        onEvent({ event: currentEvent as TranscriptEventType, data })
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
      // Keep the last partial line in the buffer
      buffer = lines.pop() || ""

      for (const rawLine of lines) {
        const line = rawLine.trimEnd()

        if (line.startsWith("event:")) {
          // If we were building an event, flush it before starting a new one
          if (currentEvent) {
            flushEvent()
          }
          currentEvent = line.slice(6).trim()
          continue
        }

        if (line.startsWith("data:")) {
          currentDataLines.push(line.slice(5).trimStart())
          continue
        }

        // Empty line usually means end of event in SSE standard, 
        // but some servers send multiple data lines. 
        // We flush when we see a new event or at the end.
        // Standard SSE uses double newline to separate events.
        if (line === "" && currentEvent && currentDataLines.length > 0) {
          flushEvent()
        }
      }
    }
  },
}
