"use client"

import { useEffect, useState } from "react"
import { realtimeWSManager } from "@/lib/realtime-ws"
import { Loader2, WifiOff } from "lucide-react"

type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting"

/**
 * Connection status indicator component.
 * Shows a toast-like notification when WebSocket is not connected.
 * Hidden when connection is healthy.
 */
export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>("disconnected")

  useEffect(() => {
    // Get initial state
    setState(realtimeWSManager.getState())

    // Subscribe to state changes
    const unsubscribe = realtimeWSManager.onStateChange(setState)
    return unsubscribe
  }, [])

  // Only show when not connected
  if (state === "connected") return null

  const statusConfig = {
    disconnected: {
      icon: WifiOff,
      text: "连接已断开",
      spinning: false,
      className: "bg-red-50 text-red-700 border-red-200",
    },
    connecting: {
      icon: Loader2,
      text: "正在连接...",
      spinning: true,
      className: "bg-yellow-50 text-yellow-700 border-yellow-200",
    },
    reconnecting: {
      icon: Loader2,
      text: "正在重连...",
      spinning: true,
      className: "bg-yellow-50 text-yellow-700 border-yellow-200",
    },
  }

  const config = statusConfig[state]
  const Icon = config.icon

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 px-4 py-2 rounded-lg border shadow-sm flex items-center gap-2 ${config.className}`}
    >
      <Icon className={`h-4 w-4 ${config.spinning ? "animate-spin" : ""}`} />
      <span className="text-sm font-medium">{config.text}</span>
    </div>
  )
}
