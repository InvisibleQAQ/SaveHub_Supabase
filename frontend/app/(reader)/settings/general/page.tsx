"use client"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { useRSSStore } from "@/lib/store"

export default function GeneralSettingsPage() {
  const { settings, updateSettings } = useRSSStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">General</h1>
        <p className="text-muted-foreground mt-2">Manage general application settings</p>
      </div>

      <Separator />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="auto-refresh">Auto Refresh</Label>
            <p className="text-sm text-muted-foreground">Automatically refresh feeds in the background</p>
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
              <Label htmlFor="refresh-interval">Refresh Interval</Label>
              <span className="text-sm text-muted-foreground font-medium">{settings.refreshInterval} minutes</span>
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
            <p className="text-xs text-muted-foreground">Set how often feeds should be refreshed automatically</p>
          </div>
        )}
      </div>
    </div>
  )
}