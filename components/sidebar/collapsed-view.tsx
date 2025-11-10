"use client"

import { usePathname, useRouter } from "next/navigation"
import { ChevronRight, BookOpen, Rss, Star, Settings, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ViewButton } from "./view-button"
import { FeedItem } from "./feed-item"
import { useRSSStore } from "@/lib/store"
import { supabase } from "@/lib/supabase/client"

interface CollapsedViewProps {
  onExpand: () => void
  totalArticles: number
  totalUnread: number
  totalStarred: number
}

export function CollapsedView({ onExpand, totalArticles, totalUnread, totalStarred }: CollapsedViewProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { feeds } = useRSSStore()

  const handleLogout = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground items-center py-2 cursor-pointer" onClick={onExpand}>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 mb-2 flex items-center justify-center"
        onClick={(e) => {
          e.stopPropagation()
          onExpand()
        }}
        title="Expand sidebar"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      <Separator className="my-2 bg-sidebar-border w-8" />

      <div className="flex flex-col items-center space-y-1">
        <ViewButton href="/all" icon={BookOpen} label="All Articles" count={totalArticles} isActive={pathname === "/all"} variant="icon" />
        <ViewButton href="/unread" icon={Rss} label="Unread" count={totalUnread} isActive={pathname === "/unread"} variant="icon" />
        <ViewButton href="/starred" icon={Star} label="Starred" count={totalStarred} isActive={pathname === "/starred"} variant="icon" />
      </div>

      <Separator className="my-2 bg-sidebar-border w-8" />

      <ScrollArea className="flex-1 w-full">
        <div className="flex flex-col items-center space-y-1 py-1">
          {feeds.map((feed) => {
            const isActive = pathname === `/feed/${feed.id}`
            return <FeedItem key={feed.id} feed={feed} unreadCount={0} isActive={isActive} variant="icon" />
          })}
        </div>
      </ScrollArea>

      <Separator className="my-2 bg-sidebar-border w-8" />

      <ViewButton href="/settings" icon={Settings} label="Settings" isActive={pathname.startsWith("/settings")} variant="icon" />

      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 mt-1 text-sidebar-foreground hover:bg-sidebar-accent"
        onClick={handleLogout}
        title="Logout"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  )
}