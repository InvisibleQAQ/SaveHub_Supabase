"use client"

import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Download, Upload, Trash2 } from "lucide-react"
import { useRSSStore } from "@/lib/store"
import { dbManager } from "@/lib/db"
import { useToast } from "@/hooks/use-toast"

export default function StorageSettingsPage() {
  const { settings, updateSettings, syncToSupabase } = useRSSStore()
  const { toast } = useToast()

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

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={handleExportData} className="w-full">
              <Download className="h-4 w-4 mr-2" />
              Export Data
            </Button>
            <Button variant="outline" onClick={handleImportData} className="w-full">
              <Upload className="h-4 w-4 mr-2" />
              Import Data
            </Button>
          </div>

          <Button variant="destructive" onClick={handleClearData} className="w-full">
            <Trash2 className="h-4 w-4 mr-2" />
            Clear All Data
          </Button>
        </div>
      </div>
    </div>
  )
}