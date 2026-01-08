"use client"

import { useEffect } from "react"
import {
  MessageSquare,
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeft
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useRSSStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "savehub-chat-sidebar-collapsed"

export function ChatSidebar() {
  const {
    chatSessions,
    currentSessionId,
    loadChatSessions,
    setCurrentSessionId,
    deleteChatSession,
    clearCurrentChat,
    isChatSidebarCollapsed,
    toggleChatSidebar,
    setChatSidebarCollapsed,
  } = useRSSStore()

  // Load sessions and restore collapsed state on mount
  useEffect(() => {
    loadChatSessions()
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved !== null) {
      setChatSidebarCollapsed(saved === "true")
    }
  }, [loadChatSessions, setChatSidebarCollapsed])

  // Persist collapsed state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isChatSidebarCollapsed))
  }, [isChatSidebarCollapsed])

  const handleNewChat = () => {
    clearCurrentChat()
  }

  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId)
  }

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    await deleteChatSession(sessionId)
  }

  // Collapsed state: only show toggle button
  if (isChatSidebarCollapsed) {
    return (
      <div className="w-12 flex-shrink-0 border-r bg-muted/30 flex flex-col items-center py-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggleChatSidebar}
          title="展开会话列表"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  // Expanded state
  return (
    <div className="w-52 flex-shrink-0 border-r bg-muted/30 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <span className="text-sm font-medium">会话列表</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={toggleChatSidebar}
          title="折叠会话列表"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* New Chat Button */}
      <div className="p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleNewChat}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="text-xs">新建对话</span>
        </Button>
      </div>

      {/* Session List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {chatSessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">暂无会话</p>
            </div>
          ) : (
            chatSessions.slice(0, 50).map((session) => (
              <div
                key={session.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-2 text-xs cursor-pointer",
                  "hover:bg-accent transition-colors",
                  currentSessionId === session.id && "bg-accent"
                )}
                onClick={() => handleSelectSession(session.id)}
              >
                <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">
                  {session.title}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:bg-destructive/20"
                  onClick={(e) => handleDeleteSession(e, session.id)}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
