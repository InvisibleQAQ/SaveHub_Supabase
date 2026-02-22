"use client"

import { useState } from "react"
import { HelpCircle, Keyboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useTranslations } from "next-intl"

export function HelpDialog() {
  const t = useTranslations("sidebar.helpDialog")
  const tSidebar = useTranslations("sidebar")
  const [open, setOpen] = useState(false)
  const shortcuts = [
    { key: t("shortcutKeys.nextArticle"), description: t("shortcuts.nextArticle") },
    { key: t("shortcutKeys.previousArticle"), description: t("shortcuts.previousArticle") },
    { key: t("shortcutKeys.toggleReadUnread"), description: t("shortcuts.toggleReadUnread") },
    { key: t("shortcutKeys.toggleStar"), description: t("shortcuts.toggleStar") },
    { key: t("shortcutKeys.openOriginalArticle"), description: t("shortcuts.openOriginalArticle") },
    { key: t("shortcutKeys.showAllArticles"), description: t("shortcuts.showAllArticles") },
    { key: t("shortcutKeys.showUnreadArticles"), description: t("shortcuts.showUnreadArticles") },
    { key: t("shortcutKeys.showStarredArticles"), description: t("shortcuts.showStarredArticles") },
    { key: t("shortcutKeys.refreshFeeds"), description: t("shortcuts.refreshFeeds") },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title={tSidebar("tooltips.helpShortcuts")}>
          <HelpCircle className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t("sections.navigation")}</h3>
            {shortcuts.slice(0, 2).map((shortcut) => (
              <div key={shortcut.key} className="flex items-center justify-between">
                <span className="text-sm">{shortcut.description}</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {shortcut.key}
                </Badge>
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t("sections.actions")}</h3>
            {shortcuts.slice(2, 5).map((shortcut) => (
              <div key={shortcut.key} className="flex items-center justify-between">
                <span className="text-sm">{shortcut.description}</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {shortcut.key}
                </Badge>
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t("sections.views")}</h3>
            {shortcuts.slice(5, 8).map((shortcut) => (
              <div key={shortcut.key} className="flex items-center justify-between">
                <span className="text-sm">{shortcut.description}</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {shortcut.key}
                </Badge>
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t("sections.other")}</h3>
            {shortcuts.slice(8).map((shortcut) => (
              <div key={shortcut.key} className="flex items-center justify-between">
                <span className="text-sm">{shortcut.description}</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {shortcut.key}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 p-4 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">
            <strong>{t("tipLabel")}</strong> {t("tipDescription")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
