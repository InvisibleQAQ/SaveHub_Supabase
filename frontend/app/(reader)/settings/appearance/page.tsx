"use client"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Moon, Sun, Monitor } from "lucide-react"
import { useRSSStore } from "@/lib/store"
import { useTheme } from "next-themes"
import { useEffect } from "react"
import { useTranslations } from "next-intl"

export default function AppearanceSettingsPage() {
  const { settings, updateSettings } = useRSSStore()
  const { theme, setTheme } = useTheme()
  const t = useTranslations("settings.appearance")

  useEffect(() => {
    if (theme && theme !== settings.theme) {
      updateSettings({ theme: theme as "light" | "dark" | "system" })
    }
  }, [theme, settings.theme, updateSettings])

  const handleThemeChange = (value: "light" | "dark" | "system") => {
    setTheme(value)
    updateSettings({ theme: value })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-2">{t("description")}</p>
      </div>

      <Separator />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="theme">{t("theme")}</Label>
            <p className="text-sm text-muted-foreground">{t("themeDescription")}</p>
          </div>
          <Select value={theme || "system"} onValueChange={handleThemeChange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4" />
                  {t("themeLight")}
                </div>
              </SelectItem>
              <SelectItem value="dark">
                <div className="flex items-center gap-2">
                  <Moon className="h-4 w-4" />
                  {t("themeDark")}
                </div>
              </SelectItem>
              <SelectItem value="system">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4" />
                  {t("themeSystem")}
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="font-size">{t("fontSize")}</Label>
            <span className="text-sm text-muted-foreground font-medium">{t("fontSizeValue", { value: settings.fontSize })}</span>
          </div>
          <Slider
            id="font-size"
            min={12}
            max={24}
            step={1}
            value={[settings.fontSize]}
            onValueChange={([value]) => updateSettings({ fontSize: value })}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">{t("fontSizeHint")}</p>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="show-thumbnails">{t("showThumbnails")}</Label>
            <p className="text-sm text-muted-foreground">{t("showThumbnailsDescription")}</p>
          </div>
          <Switch
            id="show-thumbnails"
            checked={settings.showThumbnails}
            onCheckedChange={(checked) => updateSettings({ showThumbnails: checked })}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="mark-read-scroll">{t("markAsReadOnScroll")}</Label>
            <p className="text-sm text-muted-foreground">{t("markAsReadOnScrollDescription")}</p>
          </div>
          <Switch
            id="mark-read-scroll"
            checked={settings.markAsReadOnScroll}
            onCheckedChange={(checked) => updateSettings({ markAsReadOnScroll: checked })}
          />
        </div>
      </div>
    </div>
  )
}