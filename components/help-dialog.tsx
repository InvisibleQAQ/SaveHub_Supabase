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

const shortcuts = [
  { key: "j / ↓", description: "Next article" },
  { key: "k / ↑", description: "Previous article" },
  { key: "m", description: "Toggle read/unread" },
  { key: "s", description: "Toggle star" },
  { key: "o / Enter", description: "Open original article" },
  { key: "1", description: "Show all articles" },
  { key: "2", description: "Show unread articles" },
  { key: "3", description: "Show starred articles" },
  { key: "Ctrl+R", description: "Refresh feeds" },
]

export function HelpDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Help & Shortcuts">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>Use these shortcuts to navigate quickly through your RSS feeds</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Navigation</h3>
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
            <h3 className="text-sm font-medium">Actions</h3>
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
            <h3 className="text-sm font-medium">Views</h3>
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
            <h3 className="text-sm font-medium">Other</h3>
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
            <strong>Tip:</strong> These shortcuts work when you're not typing in a search box or input field.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
