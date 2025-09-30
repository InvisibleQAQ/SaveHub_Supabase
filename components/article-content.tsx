"use client"
import { ExternalLink, Star, Share, MoreHorizontal, Clock, Check, Copy, BookOpen, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useRSSStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { formatDistanceToNow, formatFullDate, sanitizeHTML, estimateReadingTime } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

export function ArticleContent() {
  const { articles, feeds, selectedArticleId, markAsRead, markAsUnread, toggleStar, settings, updateSettings, isSidebarCollapsed, setSidebarCollapsed } =
    useRSSStore()
  const { toast } = useToast()

  const selectedArticle = articles.find((a) => a.id === selectedArticleId)
  const selectedFeed = selectedArticle ? feeds.find((f) => f.id === selectedArticle.feedId) : null

  const handleShare = async () => {
    if (!selectedArticle) return

    try {
      if (navigator.share) {
        await navigator.share({
          title: selectedArticle.title,
          url: selectedArticle.url,
        })
      } else {
        await navigator.clipboard.writeText(selectedArticle.url)
        toast({
          title: "Link copied",
          description: "Article link copied to clipboard",
        })
      }
    } catch (error) {
      console.error("Error sharing:", error)
    }
  }

  const handleCopyLink = async () => {
    if (!selectedArticle) return

    try {
      await navigator.clipboard.writeText(selectedArticle.url)
      toast({
        title: "Link copied",
        description: "Article link copied to clipboard",
      })
    } catch (error) {
      console.error("Error copying link:", error)
      toast({
        title: "Error",
        description: "Failed to copy link",
        variant: "destructive",
      })
    }
  }

  const adjustFontSize = (delta: number) => {
    const newSize = Math.max(12, Math.min(24, settings.fontSize + delta))
    updateSettings({ fontSize: newSize })
  }

  if (!selectedArticle) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground" onClick={() => !isSidebarCollapsed && setSidebarCollapsed(true)}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
            <BookOpen className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-medium mb-2">Select an article to read</h3>
          <p className="text-sm text-pretty">
            Choose an article from the list to view its content here. You can browse by feed, search for specific
            topics, or filter by read status.
          </p>
        </div>
      </div>
    )
  }

  const readingTime = estimateReadingTime(selectedArticle.content)
  const sanitizedContent = sanitizeHTML(selectedArticle.content)

  return (
    <div className="flex flex-col h-full" onClick={() => !isSidebarCollapsed && setSidebarCollapsed(true)}>
      {/* Header */}
      <div className="p-6 border-b border-border bg-card/50 flex-shrink-0">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-foreground leading-tight mb-3 text-balance">
              {selectedArticle.title}
            </h1>

            <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
              {selectedFeed && (
                <>
                  <Badge variant="outline">{selectedFeed.title}</Badge>
                  <span>•</span>
                </>
              )}
              {selectedArticle.author && (
                <>
                  <span>By {selectedArticle.author}</span>
                  <span>•</span>
                </>
              )}
              <span title={formatFullDate(selectedArticle.publishedAt)}>
                {formatDistanceToNow(selectedArticle.publishedAt)}
              </span>
              <span>•</span>
              <span>{readingTime} min read</span>
            </div>
          </div>

          {/* Article Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => adjustFontSize(-2)}
              className="h-9 w-9"
              title="Decrease font size"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => adjustFontSize(2)}
              className="h-9 w-9"
              title="Increase font size"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleStar(selectedArticle.id)}
              className={cn("h-9 w-9", selectedArticle.isStarred && "text-yellow-500")}
              title={selectedArticle.isStarred ? "Remove star" : "Add star"}
            >
              <Star className={cn("h-4 w-4", selectedArticle.isStarred && "fill-current")} />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open(selectedArticle.url, "_blank")}
              className="h-9 w-9"
              title="Open original article"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    selectedArticle.isRead ? markAsUnread(selectedArticle.id) : markAsRead(selectedArticle.id)
                  }}
                >
                  {selectedArticle.isRead ? (
                    <>
                      <Clock className="h-4 w-4 mr-2" />
                      Mark as Unread
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Mark as Read
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleShare}>
                  <Share className="h-4 w-4 mr-2" />
                  Share Article
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyLink}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Read status indicator */}
        <div className="flex items-center gap-4">
          {!selectedArticle.isRead && (
            <div className="flex items-center gap-2 text-xs text-primary">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span>Unread</span>
            </div>
          )}
          {selectedArticle.isStarred && (
            <div className="flex items-center gap-2 text-xs text-yellow-600">
              <Star className="w-3 h-3 fill-current" />
              <span>Starred</span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-6">
            {selectedArticle.thumbnail && (
              <div className="mb-6">
                <img
                  src={selectedArticle.thumbnail || "/placeholder.svg"}
                  alt=""
                  className="w-full max-w-2xl mx-auto rounded-lg shadow-sm"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"
                  }}
                />
              </div>
            )}

            <div
              className="prose prose-gray dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground prose-a:text-primary prose-strong:text-foreground prose-code:text-foreground prose-pre:bg-muted prose-blockquote:text-muted-foreground prose-blockquote:border-l-border prose-img:rounded-lg prose-img:shadow-sm"
              style={{ fontSize: `${settings.fontSize}px`, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: sanitizedContent }}
            />

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-border">
              <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <span>Published {formatFullDate(selectedArticle.publishedAt)}</span>
                  {selectedFeed && (
                    <>
                      <span>•</span>
                      <span>From {selectedFeed.title}</span>
                    </>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(selectedArticle.url, "_blank")}
                  className="gap-2"
                >
                  <ExternalLink className="h-3 w-3" />
                  Read Original
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
