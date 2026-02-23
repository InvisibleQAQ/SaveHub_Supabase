"use client"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { useRSSStore } from "@/lib/store"
import { useTranslations } from "next-intl"

export default function GeneralSettingsPage() {
  const { settings, updateSettings } = useRSSStore()
  const t = useTranslations("settings.general")

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
            <Label htmlFor="auto-refresh">{t("autoRefresh")}</Label>
            <p className="text-sm text-muted-foreground">{t("autoRefreshDescription")}</p>
          </div>
          <Switch
            id="auto-refresh"
            checked={settings.autoRefresh}
            onCheckedChange={(checked) => updateSettings({ autoRefresh: checked })}
          />
        </div>

        {settings.autoRefresh && (
          <div className="space-y-3 pl-6 border-l-2 border-muted">
            <div className="flex items-center justify-between">
              <Label htmlFor="refresh-interval">{t("refreshInterval")}</Label>
              <span className="text-sm text-muted-foreground font-medium">{t("minutes", { value: settings.refreshInterval })}</span>
            </div>
            <Slider
              id="refresh-interval"
              min={5}
              max={120}
              step={5}
              value={[settings.refreshInterval]}
              onValueChange={([value]) => updateSettings({ refreshInterval: value })}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">{t("refreshIntervalHint")}</p>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">{t("fullTextFetch")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("fullTextFetchDescription")}</p>
        </div>
      </div>
    </div>
  )
}