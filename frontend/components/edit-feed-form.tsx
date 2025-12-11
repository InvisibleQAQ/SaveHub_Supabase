"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useRSSStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"
import { feedsApi } from "@/lib/api/feeds"
import { validateRSSUrl } from "@/lib/rss-parser"

interface EditFeedFormProps {
  feedId: string
}

export function EditFeedForm({ feedId }: EditFeedFormProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { feeds, folders, settings, updateFeed } = useRSSStore()

  const feed = feeds.find(f => f.id === feedId)

  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: "",
    url: "",
    description: "",
    category: "",
    folderId: "none" as string,
    refreshInterval: 60,
    enableDeduplication: false,
  })

  useEffect(() => {
    if (feed) {
      setFormData({
        title: feed.title,
        url: feed.url,
        description: feed.description || "",
        category: feed.category || "",
        folderId: feed.folderId || "none",
        refreshInterval: feed.refreshInterval,
        enableDeduplication: feed.enableDeduplication,
      })
    }
  }, [feed])

  if (!feed) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <h2 className="text-2xl font-bold mb-2">Feed Not Found</h2>
        <p className="text-muted-foreground mb-4">
          The feed you're looking for doesn't exist.
        </p>
        <Button onClick={() => router.push("/all")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to All Articles
        </Button>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.title.trim()) {
      toast({
        title: "Error",
        description: "Feed title is required",
        variant: "destructive",
      })
      return
    }

    if (!formData.url.trim()) {
      toast({
        title: "Error",
        description: "Feed URL is required",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)

    try {
      // Validate URL if it has changed
      if (formData.url !== feed.url) {
        const isValid = await validateRSSUrl(formData.url)
        if (!isValid) {
          toast({
            title: "Invalid URL",
            description: "The provided URL is not a valid RSS feed",
            variant: "destructive",
          })
          setIsLoading(false)
          return
        }
      }

      // Prepare updates
      const updates = {
        title: formData.title.trim(),
        url: formData.url.trim(),
        description: formData.description.trim() || undefined,
        category: formData.category.trim() || undefined,
        folderId: formData.folderId === "none" ? undefined : formData.folderId,
        refreshInterval: formData.refreshInterval,
        enableDeduplication: formData.enableDeduplication,
      }

      // Update in store
      updateFeed(feedId, updates)

      // Update in database via HTTP API
      await feedsApi.updateFeed(feedId, updates)

      toast({
        title: "Success",
        description: "Feed properties updated successfully",
      })

      // Navigate back to the feed
      router.push(`/feed/${feedId}`)
    } catch (error) {
      console.error("Error updating feed:", error)
      // Handle duplicate URL error
      if (error instanceof Error && error.message === "duplicate") {
        toast({
          title: "Duplicate Feed",
          description: "A feed with this URL already exists",
          variant: "destructive",
        })
      } else {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to update feed",
          variant: "destructive",
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    router.push(`/feed/${feedId}`)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-4">
        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            disabled={isLoading}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">Edit Feed Properties</h1>
        </div>
        <p className="text-sm text-muted-foreground ml-10">
          Update the properties of "{feed.title}"
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              disabled={isLoading}
              placeholder="Feed title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">
              RSS Feed URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="url"
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              disabled={isLoading}
              placeholder="https://example.com/feed.xml"
            />
            <p className="text-xs text-muted-foreground">
              Changing the URL will validate the new feed URL
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              disabled={isLoading}
              placeholder="Feed description (optional)"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              type="text"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              disabled={isLoading}
              placeholder="Category (optional)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="folder">Folder</Label>
            <Select
              value={formData.folderId}
              onValueChange={(value) => setFormData({ ...formData, folderId: value })}
              disabled={isLoading}
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
            <Label htmlFor="refreshInterval">
              Refresh Interval (minutes) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="refreshInterval"
              type="number"
              min="1"
              max="10080"
              value={formData.refreshInterval}
              onChange={(e) => setFormData({ ...formData, refreshInterval: parseInt(e.target.value) || 60 })}
              disabled={isLoading}
              placeholder={`Default: ${settings.refreshInterval} minutes`}
            />
            <p className="text-xs text-muted-foreground">
              How often to check for new articles (1 minute to 1 week). Default: {settings.refreshInterval} minutes
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="enableDeduplication">
                  Enable Article Deduplication
                </Label>
                <p className="text-xs text-muted-foreground">
                  Automatically filter out articles with identical title and content
                </p>
              </div>
              <Switch
                id="enableDeduplication"
                checked={formData.enableDeduplication}
                onCheckedChange={(checked) => setFormData({ ...formData, enableDeduplication: checked })}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
