/**
 * WebSocket-based Realtime Manager for FastAPI backend.
 *
 * Replaces Supabase Realtime with direct WebSocket connection to FastAPI.
 * Provides automatic reconnection, heartbeat, and compatible callback interface.
 */

import type { Database } from "./supabase/types"

type FeedRow = Database["public"]["Tables"]["feeds"]["Row"]
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"]
type FolderRow = Database["public"]["Tables"]["folders"]["Row"]

type TableName = "feeds" | "articles" | "folders"
type EventType = "INSERT" | "UPDATE" | "DELETE"

/** Message format from FastAPI WebSocket */
interface WSMessage {
  type: "postgres_changes" | "pong" | "error"
  table?: TableName
  event?: EventType
  payload?: {
    new: Record<string, unknown> | null
    old: Record<string, unknown> | null
  }
  message?: string
}

/** Connection state */
type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting"

/** Callback types for each table */
interface TableCallbacks<T> {
  onInsert?: (row: T) => void
  onUpdate?: (row: T) => void
  onDelete?: (id: string) => void
}

interface RealtimeWSConfig {
  /** WebSocket URL (default: derived from window.location) */
  url?: string
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number
  /** Max reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number
}

const DEFAULT_CONFIG: Required<RealtimeWSConfig> = {
  url: "",
  heartbeatInterval: 30000,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  maxReconnectAttempts: Infinity,
}

export class RealtimeWSManager {
  private ws: WebSocket | null = null
  private config: Required<RealtimeWSConfig>
  private state: ConnectionState = "disconnected"
  private reconnectAttempts = 0
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastPongTime = 0

  // Callback storage
  private feedCallbacks: TableCallbacks<FeedRow> = {}
  private articleCallbacks: TableCallbacks<ArticleRow> = {}
  private folderCallbacks: TableCallbacks<FolderRow> = {}

  // Event listeners for state changes
  private stateListeners: Set<(state: ConnectionState) => void> = new Set()

  constructor(config: RealtimeWSConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Get current connection state */
  getState(): ConnectionState {
    return this.state
  }

  /** Subscribe to connection state changes */
  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state
      console.log(`[WS] State changed: ${state}`)
      this.stateListeners.forEach((listener) => listener(state))
    }
  }

  /** Build WebSocket URL */
  private getWSUrl(): string {
    // Priority 1: Constructor config
    if (this.config.url) {
      return this.config.url
    }

    // Priority 2: Environment variable (full URL)
    const envUrl = process.env.NEXT_PUBLIC_FASTAPI_WS_URL
    if (envUrl) {
      return envUrl.endsWith("/api/ws/realtime") ? envUrl : `${envUrl}/api/ws/realtime`
    }

    // Priority 3: Derive from environment variables or window.location
    if (typeof window === "undefined") {
      throw new Error("WebSocket URL must be provided in non-browser environment")
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    // 读取与 next.config.mjs 相同的环境变量
    const host = process.env.NEXT_PUBLIC_BACKEND_HOST || window.location.hostname
    const port = process.env.NEXT_PUBLIC_BACKEND_PORT || ""
    const portSuffix = port ? `:${port}` : ""
    return `${protocol}//${host}${portSuffix}/api/ws/realtime`
  }

  /** Fetch access token from backend session endpoint */
  private async fetchAccessToken(): Promise<string | null> {
    try {
      const response = await fetch("/api/backend/auth/session", {
        credentials: "include",
      })
      if (!response.ok) {
        console.warn("[WS] Failed to fetch session:", response.status)
        return null
      }
      const data = await response.json()
      if (data.authenticated && data.access_token) {
        return data.access_token
      }
      console.warn("[WS] Not authenticated or no access token")
      return null
    } catch (error) {
      console.error("[WS] Error fetching session:", error)
      return null
    }
  }

  /** Connect to WebSocket server */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      console.log("[WS] Already connected or connecting")
      return
    }

    this.setState("connecting")

    // Fetch token for cross-origin WebSocket auth
    const token = await this.fetchAccessToken()
    if (!token) {
      console.warn("[WS] No token available, cannot connect")
      this.setState("disconnected")
      return
    }

    const baseUrl = this.getWSUrl()
    const url = `${baseUrl}?token=${encodeURIComponent(token)}`
    console.log(`[WS] Connecting to ${baseUrl}`)

    try {
      this.ws = new WebSocket(url)
      this.setupEventHandlers()
    } catch (error) {
      console.error("[WS] Connection error:", error)
      this.scheduleReconnect()
    }
  }

  private setupEventHandlers(): void {
    if (!this.ws) return

    this.ws.onopen = () => {
      console.log("[WS] Connected")
      this.setState("connected")
      this.reconnectAttempts = 0
      this.startHeartbeat()
    }

    this.ws.onclose = (event) => {
      console.log(`[WS] Closed: code=${event.code}, reason=${event.reason}`)
      this.cleanup()

      // 4001 = unauthorized, don't reconnect
      if (event.code === 4001) {
        console.log("[WS] Unauthorized, not reconnecting")
        this.setState("disconnected")
        return
      }

      // Schedule reconnect for other close reasons
      this.scheduleReconnect()
    }

    this.ws.onerror = (event) => {
      console.error("[WS] Error:", event)
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data)
    }
  }

  private handleMessage(data: string): void {
    try {
      const message: WSMessage = JSON.parse(data)

      if (message.type === "pong") {
        this.lastPongTime = Date.now()
        return
      }

      if (message.type === "error") {
        console.error("[WS] Server error:", message.message)
        return
      }

      if (message.type === "postgres_changes" && message.table && message.event && message.payload) {
        this.dispatchChange(message.table, message.event, message.payload)
      }
    } catch (error) {
      console.error("[WS] Failed to parse message:", error)
    }
  }

  private dispatchChange(
    table: TableName,
    event: EventType,
    payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null }
  ): void {
    console.log(`[WS] ${table} ${event}:`, payload)

    switch (table) {
      case "feeds":
        this.dispatchTableChange(this.feedCallbacks, event, payload)
        break
      case "articles":
        this.dispatchTableChange(this.articleCallbacks, event, payload)
        break
      case "folders":
        this.dispatchTableChange(this.folderCallbacks, event, payload)
        break
    }
  }

  private dispatchTableChange<T>(
    callbacks: TableCallbacks<T>,
    event: EventType,
    payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null }
  ): void {
    switch (event) {
      case "INSERT":
        if (callbacks.onInsert && payload.new) {
          callbacks.onInsert(payload.new as T)
        }
        break
      case "UPDATE":
        if (callbacks.onUpdate && payload.new) {
          callbacks.onUpdate(payload.new as T)
        }
        break
      case "DELETE":
        if (callbacks.onDelete && payload.old) {
          const oldRecord = payload.old as { id: string }
          callbacks.onDelete(oldRecord.id)
        }
        break
    }
  }

  /** Start heartbeat timer */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.lastPongTime = Date.now()

    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return
      }

      // Check if last pong is too old (missed 2 heartbeats)
      const timeSinceLastPong = Date.now() - this.lastPongTime
      if (timeSinceLastPong > this.config.heartbeatInterval * 2) {
        console.warn("[WS] Heartbeat timeout, reconnecting...")
        this.ws.close(4000, "Heartbeat timeout")
        return
      }

      // Send ping
      try {
        this.ws.send(JSON.stringify({ type: "ping" }))
      } catch (error) {
        console.error("[WS] Failed to send ping:", error)
      }
    }, this.config.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** Schedule reconnection with exponential backoff */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.log("[WS] Max reconnect attempts reached")
      this.setState("disconnected")
      return
    }

    this.setState("reconnecting")

    // Exponential backoff with jitter
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      this.config.maxReconnectDelay
    )

    console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts + 1})`)

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectAttempts++
      await this.connect()
    }, delay)
  }

  private cleanup(): void {
    this.stopHeartbeat()

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.ws = null
  }

  /** Disconnect and stop all activity */
  disconnect(): void {
    console.log("[WS] Disconnecting")
    this.cleanup()

    if (this.ws) {
      this.ws.close(1000, "Client disconnect")
      this.ws = null
    }

    this.setState("disconnected")
    this.reconnectAttempts = 0
  }

  // ============================================
  // Subscription API (compatible with RealtimeManager)
  // ============================================

  /**
   * Subscribe to feeds changes.
   * Auto-connects if not already connected.
   */
  subscribeToFeeds(
    onInsert?: (feed: FeedRow) => void,
    onUpdate?: (feed: FeedRow) => void,
    onDelete?: (id: string) => void
  ): void {
    this.feedCallbacks = { onInsert, onUpdate, onDelete }
    this.ensureConnected()
  }

  /**
   * Subscribe to articles changes.
   * Auto-connects if not already connected.
   */
  subscribeToArticles(
    onInsert?: (article: ArticleRow) => void,
    onUpdate?: (article: ArticleRow) => void,
    onDelete?: (id: string) => void
  ): void {
    this.articleCallbacks = { onInsert, onUpdate, onDelete }
    this.ensureConnected()
  }

  /**
   * Subscribe to folders changes.
   * Auto-connects if not already connected.
   */
  subscribeToFolders(
    onInsert?: (folder: FolderRow) => void,
    onUpdate?: (folder: FolderRow) => void,
    onDelete?: (id: string) => void
  ): void {
    this.folderCallbacks = { onInsert, onUpdate, onDelete }
    this.ensureConnected()
  }

  private ensureConnected(): void {
    if (this.state === "disconnected") {
      void this.connect()
    }
  }

  /** Unsubscribe from all tables and disconnect */
  unsubscribeAll(): void {
    console.log("[WS] Unsubscribing from all tables")
    this.feedCallbacks = {}
    this.articleCallbacks = {}
    this.folderCallbacks = {}
    this.disconnect()
  }

  /** Check if there are any active subscriptions */
  hasSubscriptions(): boolean {
    return (
      Object.keys(this.feedCallbacks).length > 0 ||
      Object.keys(this.articleCallbacks).length > 0 ||
      Object.keys(this.folderCallbacks).length > 0
    )
  }
}

// Singleton instance for app-wide use
export const realtimeWSManager = new RealtimeWSManager()
