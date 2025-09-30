"use client"

import { usePathname } from "next/navigation"
import { ChevronRight, BookOpen, Rss, Star, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ViewButton } from "./view-button"
import { FeedItem } from "./feed-item"
import { useRSSStore } from "@/lib/store"

interface CollapsedViewProps {
  onExpand: () => void
  totalArticles: number
  totalUnread: number
  totalStarred: number
}

export function CollapsedView({ onExpand, totalArticles, totalUnread, totalStarred }: CollapsedViewProps) {
  const pathname = usePathname()
  const { feeds } = useRSSStore()

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground items-center py-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 mb-2 flex items-center justify-center"
        onClick={onExpand}
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
    </div>
  )
}