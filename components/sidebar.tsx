"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Plus,
  Search,
  Star,
  BookOpen,
  Rss,
  MoreHorizontal,
  Trash2,
  RefreshCw,
  Folder,
  FolderPlus,
  Edit,
  FolderOpen,
  ArrowRightToLine,
  ChevronLeft,
  ChevronRight,
  Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useRSSStore } from "@/lib/store"
import { AddFeedDialog } from "./add-feed-dialog"
import { AddFolderDialog } from "./add-folder-dialog"
import { RenameDialog } from "./rename-dialog"
import { MoveToFolderDialog } from "./move-to-folder-dialog"
import { FeedRefresh } from "./feed-refresh"
import { HelpDialog } from "./help-dialog"
import { cn } from "@/lib/utils"

export function Sidebar() {
  const [showAddFeed, setShowAddFeed] = useState(false)
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [feedSearch, setFeedSearch] = useState("")
  const [selectedFolderId, setSelectedFolderId] = useState<string>("")
  const [renameDialog, setRenameDialog] = useState<{
    open: boolean
    type: "folder" | "feed"
    id: string
    currentName: string
  }>({ open: false, type: "folder", id: "", currentName: "" })
  const [moveDialog, setMoveDialog] = useState<{
    open: boolean
    feedId: string
    feedTitle: string
    currentFolderId?: string
  }>({ open: false, feedId: "", feedTitle: "", currentFolderId: undefined })
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())

  const pathname = usePathname()
  const {
    folders,
    feeds,
    removeFeed,
    removeFolder,
    renameFolder,
    getUnreadCount,
    isSidebarCollapsed,
    toggleSidebar,
  } = useRSSStore()

  const totalUnread = getUnreadCount()

  // Filter feeds and folders based on search
  const filteredFolders = folders.filter((folder) => folder.name.toLowerCase().includes(feedSearch.toLowerCase()))

  const filteredFeeds = feeds.filter(
    (feed) =>
      feed.title.toLowerCase().includes(feedSearch.toLowerCase()) ||
      feed.description?.toLowerCase().includes(feedSearch.toLowerCase()),
  )

  // Group feeds by folder
  const feedsByFolder = filteredFeeds.reduce(
    (acc, feed) => {
      const folderId = feed.folderId || "none"
      if (!acc[folderId]) acc[folderId] = []
      acc[folderId].push(feed)
      return acc
    },
    {} as Record<string, typeof feeds>,
  )

  const toggleFolder = (folderId: string) => {
    const newOpenFolders = new Set(openFolders)
    if (newOpenFolders.has(folderId)) {
      newOpenFolders.delete(folderId)
    } else {
      newOpenFolders.add(folderId)
    }
    setOpenFolders(newOpenFolders)
  }

  const handleRenameFolder = async (newName: string) => {
    renameFolder(renameDialog.id, newName)
  }

  const handleRenameFeed = async (newName: string) => {
    // Note: This would need to be implemented in the store
    console.log("Rename feed not implemented yet")
  }

  if (isSidebarCollapsed) {
    return (
      <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground items-center py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 mb-2 flex items-center justify-center"
          onClick={toggleSidebar}
          title="Expand sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <Separator className="my-2 bg-sidebar-border w-8" />

        <div className="flex flex-col items-center space-y-1">
          <Button
            variant={pathname === "/all" ? "secondary" : "ghost"}
            size="icon"
            className={cn(
              "h-10 w-10 flex items-center justify-center",
              pathname === "/all" && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
            )}
            title="All Articles"
            asChild
          >
            <Link href="/all">
              <BookOpen className="h-4 w-4" />
            </Link>
          </Button>

          <Button
            variant={pathname === "/unread" ? "secondary" : "ghost"}
            size="icon"
            className={cn(
              "h-10 w-10 flex items-center justify-center",
              pathname === "/unread" && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
            )}
            title="Unread"
            asChild
          >
            <Link href="/unread">
              <Rss className="h-4 w-4" />
            </Link>
          </Button>

          <Button
            variant={pathname === "/starred" ? "secondary" : "ghost"}
            size="icon"
            className={cn(
              "h-10 w-10 flex items-center justify-center",
              pathname === "/starred" && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
            )}
            title="Starred"
            asChild
          >
            <Link href="/starred">
              <Star className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <Separator className="my-2 bg-sidebar-border w-8" />

        <ScrollArea className="flex-1 w-full">
          <div className="flex flex-col items-center space-y-1 py-1">
            {feeds.map((feed) => {
              const isSelected = pathname === `/feed/${feed.id}`
              return (
                <Button
                  key={feed.id}
                  variant={isSelected ? "secondary" : "ghost"}
                  size="icon"
                  className={cn(
                    "h-10 w-10 flex items-center justify-center",
                    isSelected && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
                  )}
                  title={feed.title}
                  asChild
                >
                  <Link href={`/feed/${feed.id}`}>
                    <Rss className="h-4 w-4" />
                  </Link>
                </Button>
              )
            })}
          </div>
        </ScrollArea>

        <Separator className="my-2 bg-sidebar-border w-8" />

        <Button
          variant={pathname.startsWith("/settings") ? "secondary" : "ghost"}
          size="icon"
          className={cn(
            "h-10 w-10 flex items-center justify-center",
            pathname.startsWith("/settings") && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
          )}
          title="Settings"
          asChild
        >
          <Link href="/settings">
            <Settings className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-sidebar-foreground">RSS Reader</h1>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
              title="Collapse sidebar"
              onClick={toggleSidebar}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <HelpDialog />
            <FeedRefresh className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
              title="Add RSS Feed"
              onClick={() => setShowAddFeed(true)}
            >
              <Rss className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
              title="Add Folder"
              onClick={() => setShowAddFolder(true)}
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-sidebar-foreground/60" />
          <Input
            placeholder="Search feeds and folders..."
            value={feedSearch}
            onChange={(e) => setFeedSearch(e.target.value)}
            className="pl-9 bg-sidebar-accent border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/60"
          />
        </div>
      </div>

      {/* View Mode Filters */}
      <div className="p-4 space-y-2">
        <Button
          variant={pathname === "/all" ? "secondary" : "ghost"}
          className={cn(
            "w-full justify-start gap-3 text-sidebar-foreground",
            pathname === "/all" ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
          asChild
        >
          <Link href="/all">
            <BookOpen className="h-4 w-4" />
            All Articles
            {totalUnread > 0 && (
              <Badge variant="secondary" className="ml-auto bg-sidebar-accent text-sidebar-accent-foreground">
                {totalUnread}
              </Badge>
            )}
          </Link>
        </Button>

        <Button
          variant={pathname === "/unread" ? "secondary" : "ghost"}
          className={cn(
            "w-full justify-start gap-3 text-sidebar-foreground",
            pathname === "/unread" ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
          asChild
        >
          <Link href="/unread">
            <Rss className="h-4 w-4" />
            Unread
            {totalUnread > 0 && (
              <Badge variant="secondary" className="ml-auto bg-sidebar-accent text-sidebar-accent-foreground">
                {totalUnread}
              </Badge>
            )}
          </Link>
        </Button>

        <Button
          variant={pathname === "/starred" ? "secondary" : "ghost"}
          className={cn(
            "w-full justify-start gap-3 text-sidebar-foreground",
            pathname === "/starred" ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
          asChild
        >
          <Link href="/starred">
            <Star className="h-4 w-4" />
            Starred
          </Link>
        </Button>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Feeds and Folders List */}
      <div className="flex-1 overflow-hidden">
        <div className="p-4 pb-2">
          <h2 className="text-sm font-medium text-sidebar-foreground/80 uppercase tracking-wide">
            Feeds ({filteredFeeds.length})
          </h2>
        </div>

        <ScrollArea className="flex-1 px-4 custom-scrollbar">
          <div className="space-y-1 pb-4">
            {/* Folders */}
            {filteredFolders.map((folder) => {
              const folderFeeds = feedsByFolder[folder.id] || []
              const folderUnreadCount = folderFeeds.reduce((sum, feed) => sum + getUnreadCount(feed.id), 0)
              const isOpen = openFolders.has(folder.id)

              return (
                <Collapsible key={folder.id} open={isOpen} onOpenChange={() => toggleFolder(folder.id)}>
                  <div className="group relative">
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="w-full justify-start gap-3 text-left h-auto py-2 px-3 text-sidebar-foreground hover:bg-sidebar-accent"
                      >
                        {isOpen ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                        <span className="font-medium truncate">{folder.name}</span>
                        {folderUnreadCount > 0 && (
                          <Badge
                            variant="secondary"
                            className="ml-auto bg-sidebar-accent text-sidebar-accent-foreground text-xs"
                          >
                            {folderUnreadCount}
                          </Badge>
                        )}
                      </Button>
                    </CollapsibleTrigger>

                    {/* Folder Options */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-sidebar-foreground hover:bg-sidebar-accent"
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-sidebar border-sidebar-border">
                        <DropdownMenuItem onClick={() => setShowAddFeed(true)}>
                          <Plus className="h-4 w-4 mr-2" />
                          Add Feed to Folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            setRenameDialog({
                              open: true,
                              type: "folder",
                              id: folder.id,
                              currentName: folder.name,
                            })
                          }
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Rename Folder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => removeFolder(folder.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Folder
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <CollapsibleContent className="ml-4 space-y-1">
                    {folderFeeds.map((feed) => {
                      const unreadCount = getUnreadCount(feed.id)
                      const isSelected = pathname === `/feed/${feed.id}`

                      return (
                        <div key={feed.id} className="group relative">
                          <Button
                            variant="ghost"
                            className={cn(
                              "w-full justify-start gap-3 text-left h-auto py-2 px-3 text-sidebar-foreground",
                              isSelected
                                ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
                                : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            )}
                            asChild
                          >
                            <Link href={`/feed/${feed.id}`}>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium truncate">{feed.title}</span>
                                  {unreadCount > 0 && (
                                    <Badge
                                      variant="secondary"
                                      className="ml-2 bg-sidebar-accent text-sidebar-accent-foreground text-xs"
                                    >
                                      {unreadCount}
                                    </Badge>
                                  )}
                                </div>
                                {feed.description && (
                                  <p className="text-xs text-sidebar-foreground/60 truncate mt-1">{feed.description}</p>
                                )}
                              </div>
                            </Link>
                          </Button>

                          {/* Feed Options */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-sidebar-foreground hover:bg-sidebar-accent"
                              >
                                <MoreHorizontal className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-sidebar border-sidebar-border">
                              <DropdownMenuItem asChild>
                                <div className="flex items-center cursor-pointer">
                                  <RefreshCw className="h-4 w-4 mr-2" />
                                  <FeedRefresh feedId={feed.id} className="p-0 h-auto w-auto hover:bg-transparent" />
                                  <span className="ml-2">Refresh Feed</span>
                                </div>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  setMoveDialog({
                                    open: true,
                                    feedId: feed.id,
                                    feedTitle: feed.title,
                                    currentFolderId: feed.folderId,
                                  })
                                }
                              >
                                <ArrowRightToLine className="h-4 w-4 mr-2" />
                                Move to Folder
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setRenameDialog({
                                    open: true,
                                    type: "feed",
                                    id: feed.id,
                                    currentName: feed.title,
                                  })
                                }
                              >
                                <Edit className="h-4 w-4 mr-2" />
                                Rename Feed
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => removeFeed(feed.id)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Remove Feed
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )
                    })}
                  </CollapsibleContent>
                </Collapsible>
              )
            })}

            {/* Feeds without folders */}
            {feedsByFolder.none?.map((feed) => {
              const unreadCount = getUnreadCount(feed.id)
              const isSelected = pathname === `/feed/${feed.id}`

              return (
                <div key={feed.id} className="group relative">
                  <Button
                    variant="ghost"
                    className={cn(
                      "w-full justify-start gap-3 text-left h-auto py-2 px-3 text-sidebar-foreground",
                      isSelected ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                    asChild
                  >
                    <Link href={`/feed/${feed.id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate">{feed.title}</span>
                          {unreadCount > 0 && (
                            <Badge
                              variant="secondary"
                              className="ml-2 bg-sidebar-accent text-sidebar-accent-foreground text-xs"
                            >
                              {unreadCount}
                            </Badge>
                          )}
                        </div>
                        {feed.description && (
                          <p className="text-xs text-sidebar-foreground/60 truncate mt-1">{feed.description}</p>
                        )}
                        {feed.lastFetched && (
                          <p className="text-xs text-sidebar-foreground/40 mt-1">
                            Updated {new Date(feed.lastFetched).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </Link>
                  </Button>

                  {/* Feed Options */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-sidebar-foreground hover:bg-sidebar-accent"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-sidebar border-sidebar-border">
                      <DropdownMenuItem asChild>
                        <div className="flex items-center cursor-pointer">
                          <RefreshCw className="h-4 w-4 mr-2" />
                          <FeedRefresh feedId={feed.id} className="p-0 h-auto w-auto hover:bg-transparent" />
                          <span className="ml-2">Refresh Feed</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() =>
                          setMoveDialog({
                            open: true,
                            feedId: feed.id,
                            feedTitle: feed.title,
                            currentFolderId: feed.folderId,
                          })
                        }
                      >
                        <ArrowRightToLine className="h-4 w-4 mr-2" />
                        Move to Folder
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          setRenameDialog({
                            open: true,
                            type: "feed",
                            id: feed.id,
                            currentName: feed.title,
                          })
                        }
                      >
                        <Edit className="h-4 w-4 mr-2" />
                        Rename Feed
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => removeFeed(feed.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove Feed
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })}

            {filteredFeeds.length === 0 && feeds.length > 0 && (
              <div className="text-center py-8 text-sidebar-foreground/60">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No feeds match your search</p>
              </div>
            )}

            {feeds.length === 0 && (
              <div className="text-center py-8 text-sidebar-foreground/60">
                <Rss className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No feeds added yet</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddFeed(true)}
                  className="mt-2 text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  Add your first feed
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <Button
          variant={pathname.startsWith("/settings") ? "secondary" : "ghost"}
          size="sm"
          className={cn(
            "w-full justify-start gap-2 text-sidebar-foreground",
            pathname.startsWith("/settings")
              ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
              : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
          asChild
        >
          <Link href="/settings">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </Button>
      </div>

      {/* Dialogs */}
      <AddFeedDialog open={showAddFeed} onOpenChange={setShowAddFeed} defaultFolderId={selectedFolderId} />
      <AddFolderDialog open={showAddFolder} onOpenChange={setShowAddFolder} />
      <RenameDialog
        open={renameDialog.open}
        onOpenChange={(open) => setRenameDialog((prev) => ({ ...prev, open }))}
        title={renameDialog.type === "folder" ? "Rename Folder" : "Rename Feed"}
        description={`Enter a new name for this ${renameDialog.type}.`}
        currentName={renameDialog.currentName}
        onRename={renameDialog.type === "folder" ? handleRenameFolder : handleRenameFeed}
      />
      <MoveToFolderDialog
        open={moveDialog.open}
        onOpenChange={(open) => setMoveDialog((prev) => ({ ...prev, open }))}
        feedId={moveDialog.feedId}
        feedTitle={moveDialog.feedTitle}
        currentFolderId={moveDialog.currentFolderId}
      />
    </div>
  )
}
