"use client"

import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Download, Upload, Trash2, Construction } from "lucide-react"
import { useRSSStore } from "@/lib/store"

export default function StorageSettingsPage() {
  const { settings, updateSettings } = useRSSStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Storage</h1>
        <p className="text-muted-foreground mt-2">Manage data retention and backup</p>
      </div>

      <Separator />

      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="retention-days">Keep Articles</Label>
            <span className="text-sm text-muted-foreground font-medium">{settings.articlesRetentionDays} days</span>
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
          <p className="text-xs text-muted-foreground">
            Read and unstarred articles older than this will be automatically deleted
          </p>
        </div>

        <Separator />

        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">Data Management</h3>
            <p className="text-sm text-muted-foreground">Export, import, or clear your RSS reader data</p>
          </div>

          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-dashed">
            <Construction className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Feature under development</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" disabled className="w-full">
              <Download className="h-4 w-4 mr-2" />
              Export Data
            </Button>
            <Button variant="outline" disabled className="w-full">
              <Upload className="h-4 w-4 mr-2" />
              Import Data
            </Button>
          </div>

          <Button variant="destructive" disabled className="w-full">
            <Trash2 className="h-4 w-4 mr-2" />
            Clear All Data
          </Button>
        </div>
      </div>
    </div>
  )
}
