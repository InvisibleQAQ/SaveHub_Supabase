"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { MessageSquare, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useRSSStore } from "@/lib/store"
import { cn } from "@/lib/utils"

export function ChatSessionList() {
  const router = useRouter()
  const pathname = usePathname()
  const {
    chatSessions,
    currentSessionId,
    loadChatSessions,
    setCurrentSessionId,
    deleteChatSession,
    clearCurrentChat,
  } = useRSSStore()

  // Load sessions on mount
  useEffect(() => {
    loadChatSessions()
  }, [loadChatSessions])

  const handleNewChat = () => {
    clearCurrentChat()
    router.push("/chat")
  }

  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId)
    router.push("/chat")
  }

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    await deleteChatSession(sessionId)
  }

  // Only show when on chat page
  if (!pathname.startsWith("/chat")) {
    return null
  }

  return (
    <div className="mt-2 space-y-1">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
        onClick={handleNewChat}
      >
        <Plus className="h-3 w-3" />
        <span className="text-xs">New Chat</span>
      </Button>

      {chatSessions.length > 0 && (
        <ScrollArea className="max-h-[200px]">
          <div className="space-y-0.5 pr-2">
            {chatSessions.slice(0, 10).map((session) => (
              <div
                key={session.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer",
                  "hover:bg-sidebar-accent",
                  currentSessionId === session.id && "bg-sidebar-accent"
                )}
                onClick={() => handleSelectSession(session.id)}
              >
                <MessageSquare className="h-3 w-3 flex-shrink-0 text-sidebar-foreground/60" />
                <span className="flex-1 truncate text-sidebar-foreground/80">
                  {session.title}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20"
                  onClick={(e) => handleDeleteSession(e, session.id)}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
