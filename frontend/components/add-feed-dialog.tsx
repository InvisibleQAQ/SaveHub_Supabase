"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Plus, Loader2, Search, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useRSSStore } from "@/lib/store"
import { parseRSSFeed, validateRSSUrl, discoverRSSFeeds } from "@/lib/rss-parser"
import { useToast } from "@/hooks/use-toast"

interface AddFeedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultFolderId?: string
  lockFolder?: boolean
}

export function AddFeedDialog({ open, onOpenChange, defaultFolderId, lockFolder = false }: AddFeedDialogProps) {
  const [url, setUrl] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedFolderId, setSelectedFolderId] = useState<string>(defaultFolderId || "none")
  const [refreshInterval, setRefreshInterval] = useState<number | undefined>(undefined)
  const [enableDeduplication, setEnableDeduplication] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [discoveredFeeds, setDiscoveredFeeds] = useState<string[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)
  const { folders, settings, addFeed, addArticles } = useRSSStore()
  const { toast } = useToast()

  useEffect(() => {
    if (open) {
      setSelectedFolderId(defaultFolderId || "none")
    }
  }, [open, defaultFolderId])

  const handleSubmit = async (feedUrl: string) => {
    if (!feedUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a valid RSS feed URL",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    console.log("[v0] Starting to add feed:", feedUrl.trim())

    try {
      // Parse RSS and get articles
      const feedId = crypto.randomUUID()
      console.log("[v0] Generated feedId:", feedId)

      const { feed: parsedFeed, articles } = await parseRSSFeed(feedUrl.trim(), feedId)
      console.log("[v0] Parsed feed:", parsedFeed.title, "with", articles.length, "articles")

      const feed = {
        id: feedId, // Use the same feedId that was used for articles
        title: parsedFeed.title,
        url: feedUrl.trim(),
        description: parsedFeed.description,
        category: "General",
        folderId: selectedFolderId === "none" ? undefined : selectedFolderId,
        unreadCount: articles.filter((a) => !a.isRead).length,
        refreshInterval: refreshInterval, // undefined will use default from settings
        lastFetched: new Date(),
        enableDeduplication: enableDeduplication,
      }

      // Add feed and articles to store
      console.log("[v0] Adding feed to store:", feed)
      const result = await addFeed(feed)

      if (!result.success) {
        if (result.reason === 'duplicate') {
          toast({
            title: "Feed Already Exists",
            description: `"${parsedFeed.title}" is already in your feed list`,
            variant: "destructive",
          })
        } else {
          toast({
            title: "Failed to Add Feed",
            description: result.error || "An unexpected error occurred",
            variant: "destructive",
          })
        }
        setIsLoading(false)
        return
      }

      console.log("[v0] Adding articles to store:", articles.length)
      await addArticles(articles)

      toast({
        title: "Success",
        description: `Added "${parsedFeed.title}" with ${articles.length} articles`,
      })

      // Reset form and close dialog
      setUrl("")
      setSearchQuery("")
      setSelectedFolderId(defaultFolderId || "none")
      setRefreshInterval(undefined)
      setEnableDeduplication(false)
      setDiscoveredFeeds([])
      onOpenChange(false)
    } catch (error) {
      console.error("Error adding feed:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to add RSS feed",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDirectSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await handleSubmit(url)
  }

  const handleDiscoverFeeds = async () => {
    if (!searchQuery.trim()) {
      toast({
        title: "Error",
        description: "Please enter a website URL to discover feeds",
        variant: "destructive",
      })
      return
    }

    setIsDiscovering(true)
    setDiscoveredFeeds([])

    try {
      let searchUrl = searchQuery.trim()

      // Add protocol if missing
      if (!searchUrl.startsWith("http://") && !searchUrl.startsWith("https://")) {
        searchUrl = "https://" + searchUrl
      }

      const possibleFeeds = discoverRSSFeeds(searchUrl)
      const validFeeds: string[] = []

      // Test each possible feed URL
      for (const feedUrl of possibleFeeds) {
        try {
          const isValid = await validateRSSUrl(feedUrl)
          if (isValid) {
            validFeeds.push(feedUrl)
          }
        } catch {
          // Continue to next URL
        }
      }

      setDiscoveredFeeds(validFeeds)

      if (validFeeds.length === 0) {
        toast({
          title: "No feeds found",
          description: "Could not discover any RSS feeds for this website",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error discovering feeds:", error)
      toast({
        title: "Error",
        description: "Failed to discover RSS feeds",
        variant: "destructive",
      })
    } finally {
      setIsDiscovering(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add RSS Feed</DialogTitle>
          <DialogDescription>
            Add an RSS feed by entering its URL directly or by discovering feeds from a website.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="direct" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="direct" className="gap-2">
              <Globe className="h-4 w-4" />
              Direct URL
            </TabsTrigger>
            <TabsTrigger value="discover" className="gap-2">
              <Search className="h-4 w-4" />
              Discover
            </TabsTrigger>
          </TabsList>

          <TabsContent value="direct" className="space-y-4">
            <form onSubmit={handleDirectSubmit}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="feed-url">RSS Feed URL</Label>
                  <Input
                    id="feed-url"
                    type="url"
                    placeholder="https://example.com/feed.xml"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="folder">Folder (Optional)</Label>
                  <Select
                    value={selectedFolderId}
                    onValueChange={setSelectedFolderId}
                    disabled={lockFolder && !!defaultFolderId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a folder" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Folder</SelectItem>
                      {folders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="refresh-interval">Refresh Interval (minutes)</Label>
                  <Input
                    id="refresh-interval"
                    type="number"
                    min="1"
                    max="10080"
                    placeholder={`Default: ${settings.refreshInterval} minutes`}
                    value={refreshInterval ?? ""}
                    onChange={(e) => setRefreshInterval(e.target.value ? parseInt(e.target.value) : undefined)}
                    disabled={isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty to use default ({settings.refreshInterval} minutes)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="enable-deduplication">Enable Article Deduplication</Label>
                      <p className="text-xs text-muted-foreground">
                        Filter out articles with identical title and content
                      </p>
                    </div>
                    <Switch
                      id="enable-deduplication"
                      checked={enableDeduplication}
                      onCheckedChange={setEnableDeduplication}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Feed
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="discover" className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="website-url">Website URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="website-url"
                    type="url"
                    placeholder="https://example.com"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={isDiscovering}
                  />
                  <Button
                    type="button"
                    onClick={handleDiscoverFeeds}
                    disabled={isDiscovering}
                    className="flex-shrink-0"
                  >
                    {isDiscovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="folder-discover">Folder (Optional)</Label>
                <Select
                  value={selectedFolderId}
                  onValueChange={setSelectedFolderId}
                  disabled={lockFolder && !!defaultFolderId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a folder" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Folder</SelectItem>
                    {folders.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        {folder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="refresh-interval-discover">Refresh Interval (minutes)</Label>
                <Input
                  id="refresh-interval-discover"
                  type="number"
                  min="1"
                  max="10080"
                  placeholder={`Default: ${settings.refreshInterval} minutes`}
                  value={refreshInterval ?? ""}
                  onChange={(e) => setRefreshInterval(e.target.value ? parseInt(e.target.value) : undefined)}
                  disabled={isDiscovering || isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to use default ({settings.refreshInterval} minutes)
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="enable-deduplication-discover">Enable Article Deduplication</Label>
                    <p className="text-xs text-muted-foreground">
                      Filter out articles with identical title and content
                    </p>
                  </div>
                  <Switch
                    id="enable-deduplication-discover"
                    checked={enableDeduplication}
                    onCheckedChange={setEnableDeduplication}
                    disabled={isDiscovering || isLoading}
                  />
                </div>
              </div>

              {discoveredFeeds.length > 0 && (
                <div className="space-y-2">
                  <Label>Discovered Feeds</Label>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {discoveredFeeds.map((feedUrl, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{feedUrl}</p>
                        </div>
                        <Button size="sm" onClick={() => handleSubmit(feedUrl)} disabled={isLoading}>
                          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
