"use client"

import { useState, useEffect } from "react"
import { Settings, Download, Upload, Trash2, Moon, Sun, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { useRSSStore } from "@/lib/store"
import { dbManager } from "@/lib/db"
import { useToast } from "@/hooks/use-toast"
import { useTheme } from "next-themes"

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const { settings, updateSettings, syncToSupabase } = useRSSStore()
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()

  useEffect(() => {
    if (theme && theme !== settings.theme) {
      updateSettings({ theme: theme as "light" | "dark" | "system" })
    }
  }, [theme, settings.theme, updateSettings])

  const handleThemeChange = (value: "light" | "dark" | "system") => {
    setTheme(value)
    updateSettings({ theme: value })
  }

  const handleExportData = async () => {
    try {
      const data = await dbManager.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `rss-reader-backup-${new Date().toISOString().split("T")[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({
        title: "Data exported",
        description: "Your RSS reader data has been exported successfully",
      })
    } catch (error) {
      console.error("Export failed:", error)
      toast({
        title: "Export failed",
        description: "Failed to export data",
        variant: "destructive",
      })
    }
  }

  const handleImportData = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const data = JSON.parse(text)
        await dbManager.importData(data)
        await syncToSupabase()

        toast({
          title: "Data imported",
          description: "Your RSS reader data has been imported successfully",
        })

        // Reload the page to reflect changes
        window.location.reload()
      } catch (error) {
        console.error("Import failed:", error)
        toast({
          title: "Import failed",
          description: "Failed to import data. Please check the file format.",
          variant: "destructive",
        })
      }
    }
    input.click()
  }

  const handleClearData = async () => {
    if (!confirm("Are you sure you want to clear all data? This action cannot be undone.")) {
      return
    }

    try {
      await dbManager.clearAllData()
      toast({
        title: "Data cleared",
        description: "All RSS reader data has been cleared",
      })

      // Reload the page
      window.location.reload()
    } catch (error) {
      console.error("Clear data failed:", error)
      toast({
        title: "Clear failed",
        description: "Failed to clear data",
        variant: "destructive",
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
          <Settings className="h-4 w-4" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Customize your RSS reader experience</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Appearance */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Appearance</h3>

            <div className="flex items-center justify-between">
              <Label htmlFor="theme">Theme</Label>
              <Select value={theme || "system"} onValueChange={handleThemeChange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">
                    <div className="flex items-center gap-2">
                      <Sun className="h-4 w-4" />
                      Light
                    </div>
                  </SelectItem>
                  <SelectItem value="dark">
                    <div className="flex items-center gap-2">
                      <Moon className="h-4 w-4" />
                      Dark
                    </div>
                  </SelectItem>
                  <SelectItem value="system">
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4" />
                      System
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="font-size">Font Size</Label>
                <span className="text-sm text-muted-foreground">{settings.fontSize}px</span>
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
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="show-thumbnails">Show Thumbnails</Label>
              <Switch
                id="show-thumbnails"
                checked={settings.showThumbnails}
                onCheckedChange={(checked) => updateSettings({ showThumbnails: checked })}
              />
            </div>
          </div>

          <Separator />

          {/* Reading */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Reading</h3>

            <div className="flex items-center justify-between">
              <Label htmlFor="mark-read-scroll">Mark as read on scroll</Label>
              <Switch
                id="mark-read-scroll"
                checked={settings.markAsReadOnScroll}
                onCheckedChange={(checked) => updateSettings({ markAsReadOnScroll: checked })}
              />
            </div>
          </div>

          <Separator />

          {/* Sync & Storage */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Sync & Storage</h3>

            <div className="flex items-center justify-between">
              <Label htmlFor="auto-refresh">Auto Refresh</Label>
              <Switch
                id="auto-refresh"
                checked={settings.autoRefresh}
                onCheckedChange={(checked) => updateSettings({ autoRefresh: checked })}
              />
            </div>

            {settings.autoRefresh && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="refresh-interval">Refresh Interval</Label>
                  <span className="text-sm text-muted-foreground">{settings.refreshInterval} min</span>
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
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="retention-days">Keep Articles</Label>
                <span className="text-sm text-muted-foreground">{settings.articlesRetentionDays} days</span>
              </div>
              <Slider
                id="retention-days"
                min={7}
                max={365}
                step={7}
                value={[settings.articlesRetentionDays]}
                onValueChange={([value]) => updateSettings({ articlesRetentionDays: value })}
                className="w-full"
              />
            </div>
          </div>

          <Separator />

          {/* Data Management */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Data Management</h3>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExportData} className="flex-1 bg-transparent">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportData} className="flex-1 bg-transparent">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
            </div>

            <Button variant="destructive" size="sm" onClick={handleClearData} className="w-full">
              <Trash2 className="h-4 w-4 mr-2" />
              Clear All Data
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
