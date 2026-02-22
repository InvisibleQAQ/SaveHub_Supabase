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
import { validateRSSUrl } from "@/lib/rss-parser"
import { useTranslations } from "next-intl"

interface EditFeedFormProps {
  feedId: string
}

export function EditFeedForm({ feedId }: EditFeedFormProps) {
  const t = useTranslations("reader.editFeedForm")
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
    enableAutoFetchFullContent: false,
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
        enableAutoFetchFullContent: feed.enableAutoFetchFullContent ?? false,
      })
    }
  }, [feed])

  if (!feed) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <h2 className="text-2xl font-bold mb-2">{t("notFound.title")}</h2>
        <p className="text-muted-foreground mb-4">
          {t("notFound.description")}
        </p>
        <Button onClick={() => router.push("/all")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("notFound.backToAllArticles")}
        </Button>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.title.trim()) {
      toast({
        title: t("toasts.errorTitle"),
        description: t("toasts.feedTitleRequired"),
        variant: "destructive",
      })
      return
    }

    if (!formData.url.trim()) {
      toast({
        title: t("toasts.errorTitle"),
        description: t("toasts.feedUrlRequired"),
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
            title: t("toasts.invalidUrlTitle"),
            description: t("toasts.invalidRssUrl"),
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
        enableAutoFetchFullContent: formData.enableAutoFetchFullContent,
      }

      // updateFeed 已包含后端 API 持久化，这里避免重复请求
      const result = await updateFeed(feedId, updates)
      if (!result.success) {
        throw new Error(result.error || t("toasts.failedToUpdateFeed"))
      }

      toast({
        title: t("toasts.successTitle"),
        description: t("toasts.feedUpdated"),
      })

      // Navigate back to the feed
      router.push(`/feed/${feedId}`)
    } catch (error) {
      console.error("Error updating feed:", error)
      // Handle duplicate URL error
      if (error instanceof Error && error.message === "duplicate") {
        toast({
          title: t("toasts.duplicateFeedTitle"),
          description: t("toasts.duplicateFeedDescription"),
          variant: "destructive",
        })
      } else {
        toast({
          title: t("toasts.errorTitle"),
          description: error instanceof Error ? error.message : t("toasts.failedToUpdateFeed"),
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
          <h1 className="text-2xl font-bold">{t("header.title")}</h1>
        </div>
        <p className="text-sm text-muted-foreground ml-10">
          {t("header.subtitle", { feedTitle: feed.title })}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">
              {t("fields.title")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              disabled={isLoading}
              placeholder={t("fields.titlePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">
              {t("fields.rssUrl")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="url"
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              disabled={isLoading}
              placeholder={t("fields.rssUrlPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("fields.rssUrlHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t("fields.description")}</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              disabled={isLoading}
              placeholder={t("fields.descriptionPlaceholder")}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">{t("fields.category")}</Label>
            <Input
              id="category"
              type="text"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              disabled={isLoading}
              placeholder={t("fields.categoryPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="folder">{t("fields.folder")}</Label>
            <Select
              value={formData.folderId}
              onValueChange={(value) => setFormData({ ...formData, folderId: value })}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("fields.selectFolder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("fields.noFolder")}</SelectItem>
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
              {t("fields.refreshInterval")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="refreshInterval"
              type="number"
              min="1"
              max="10080"
              value={formData.refreshInterval}
              onChange={(e) => setFormData({ ...formData, refreshInterval: parseInt(e.target.value) || 60 })}
              disabled={isLoading}
              placeholder={t("fields.refreshIntervalPlaceholder", { minutes: settings.refreshInterval })}
            />
            <p className="text-xs text-muted-foreground">
              {t("fields.refreshIntervalHint", { minutes: settings.refreshInterval })}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="enableDeduplication">
                  {t("toggles.enableDeduplication")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("toggles.enableDeduplicationDescription")}
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="enableAutoFetchFullContent">
                  {t("toggles.enableAutoFetch")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("toggles.enableAutoFetchDescription")}
                </p>
              </div>
              <Switch
                id="enableAutoFetchFullContent"
                checked={formData.enableAutoFetchFullContent}
                onCheckedChange={(checked) => setFormData({ ...formData, enableAutoFetchFullContent: checked })}
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
                  {t("actions.saving")}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t("actions.saveChanges")}
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isLoading}
            >
              {t("actions.cancel")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
