"use client"

import { useState, useMemo } from "react"
import { Search, Filter, MoreHorizontal, Star, Check, Clock, ChevronDown, SortAsc, SortDesc } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { formatDistanceToNow, estimateReadingTime } from "@/lib/utils"

type SortOption = "date" | "title" | "feed" | "readTime"
type SortDirection = "asc" | "desc"

interface ArticleListProps {
  viewMode?: "all" | "unread" | "starred"
  feedId?: string | null
}

export function ArticleList({ viewMode = "all", feedId = null }: ArticleListProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [sortBy, setSortBy] = useState<SortOption>("date")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const {
    selectedArticleId,
    feeds,
    articles,
    searchQuery: globalSearchQuery,
    setSelectedArticle,
    setSearchQuery: setGlobalSearchQuery,
    getFilteredArticles,
    markAsRead,
    markAsUnread,
    toggleStar,
    isSidebarCollapsed,
    setSidebarCollapsed,
    settings,
  } = useRSSStore()

  const selectedFeed = feeds.find((f) => f.id === feedId)

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setGlobalSearchQuery(query)
  }

  const getFeedTitle = (feedId: string) => {
    const feed = feeds.find((f) => f.id === feedId)
    return feed?.title || "Unknown Feed"
  }

  // Sort and filter articles
  const sortedArticles = useMemo(() => {
    const filteredArticles = getFilteredArticles({ viewMode, feedId })
    const feedTitles = feeds.reduce(
      (acc, feed) => {
        acc[feed.id] = feed.title
        return acc
      },
      {} as Record<string, string>,
    )

    return [...filteredArticles].sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case "date":
          comparison = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
          break
        case "title":
          comparison = a.title.localeCompare(b.title)
          break
        case "feed":
          const feedA = feedTitles[a.feedId]
          const feedB = feedTitles[b.feedId]
          comparison = feedA.localeCompare(feedB)
          break
        case "readTime":
          const timeA = estimateReadingTime(a.content)
          const timeB = estimateReadingTime(b.content)
          comparison = timeA - timeB
          break
      }

      return sortDirection === "asc" ? comparison : -comparison
    })
  }, [articles, viewMode, feedId, globalSearchQuery, sortBy, sortDirection, feeds, getFilteredArticles])

  const handleSort = (option: SortOption) => {
    if (sortBy === option) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortBy(option)
      setSortDirection(option === "date" ? "desc" : "asc")
    }
  }

  const getSortLabel = () => {
    const labels = {
      date: "Date",
      title: "Title",
      feed: "Feed",
      readTime: "Read Time",
    }
    return labels[sortBy]
  }

  return (
    <div className="flex flex-col h-full bg-card" onClick={() => !isSidebarCollapsed && !settings.sidebarPinned && setSidebarCollapsed(true)}>
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-card-foreground">
              {selectedFeed ? selectedFeed.title : `${viewMode.charAt(0).toUpperCase() + viewMode.slice(1)} Articles`}
            </h2>
            <p className="text-sm text-muted-foreground">
              {sortedArticles.length} {sortedArticles.length === 1 ? "article" : "articles"}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                {getSortLabel()}
                {sortDirection === "asc" ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleSort("date")}>
                <div className="flex items-center justify-between w-full">
                  <span>Sort by Date</span>
                  {sortBy === "date" &&
                    (sortDirection === "asc" ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />)}
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("title")}>
                <div className="flex items-center justify-between w-full">
                  <span>Sort by Title</span>
                  {sortBy === "title" &&
                    (sortDirection === "asc" ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />)}
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("feed")}>
                <div className="flex items-center justify-between w-full">
                  <span>Sort by Feed</span>
                  {sortBy === "feed" &&
                    (sortDirection === "asc" ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />)}
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSort("readTime")}>
                <div className="flex items-center justify-between w-full">
                  <span>Sort by Read Time</span>
                  {sortBy === "readTime" &&
                    (sortDirection === "asc" ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />)}
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search articles..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Articles List */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="divide-y divide-border">
            {sortedArticles.map((article) => {
              const isSelected = selectedArticleId === article.id
              const readingTime = estimateReadingTime(article.content)

              return (
                <div
                  key={article.id}
                  className={cn(
                    "group relative p-4 cursor-pointer transition-colors hover:bg-accent/50",
                    isSelected && "bg-accent",
                  )}
                  onClick={() => setSelectedArticle(article.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Thumbnail */}
                    {article.thumbnail && (
                      <div className="flex-shrink-0">
                        <img
                          src={article.thumbnail || "/placeholder.svg"}
                          alt=""
                          className="w-16 h-16 rounded-md object-cover bg-muted"
                          onError={(e) => {
                            e.currentTarget.style.display = "none"
                          }}
                        />
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3
                          className={cn(
                            "font-medium text-sm leading-tight line-clamp-2 text-balance",
                            article.isRead ? "text-muted-foreground" : "text-card-foreground",
                          )}
                        >
                          {article.title}
                        </h3>

                        {/* Article Actions */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                article.isRead ? markAsUnread(article.id) : markAsRead(article.id)
                              }}
                            >
                              {article.isRead ? (
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
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleStar(article.id)
                              }}
                            >
                              <Star
                                className={cn("h-4 w-4 mr-2", article.isStarred && "fill-current text-yellow-500")}
                              />
                              {article.isStarred ? "Remove Star" : "Add Star"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                window.open(article.url, "_blank")
                              }}
                            >
                              Open Original
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Summary */}
                      {article.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2 text-pretty">{article.summary}</p>
                      )}

                      {/* Meta */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        {!selectedFeed && (
                          <>
                            <Badge variant="outline" className="text-xs">
                              {getFeedTitle(article.feedId)}
                            </Badge>
                            <span>•</span>
                          </>
                        )}
                        {article.author && (
                          <>
                            <span>{article.author}</span>
                            <span>•</span>
                          </>
                        )}
                        <span>{formatDistanceToNow(article.publishedAt)}</span>
                        <span>•</span>
                        <span>{readingTime} min read</span>

                        {/* Status indicators */}
                        <div className="flex items-center gap-1 ml-auto">
                          {article.isStarred && <Star className="h-3 w-3 fill-current text-yellow-500" />}
                          {!article.isRead && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {sortedArticles.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No articles found</p>
                {searchQuery && <p className="text-xs mt-1">Try adjusting your search terms</p>}
                {!searchQuery && feeds.length === 0 && (
                  <p className="text-xs mt-1">Add some RSS feeds to get started</p>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
