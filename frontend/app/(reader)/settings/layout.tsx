"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const settingsCategories = [
  { id: "general", label: "General", href: "/settings/general" },
  { id: "appearance", label: "Appearance", href: "/settings/appearance" },
  { id: "rag", label: "Agentic RAG", href: "/settings/rag" },
  { id: "api", label: "API Configuration", href: "/settings/api" },
  { id: "storage", label: "Storage", href: "/settings/storage" },
  { id: "github-token", label: "GitHub Token", href: "/settings/github-token" },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-border bg-muted/10">
        <ScrollArea className="h-[calc(100vh-120px)]">
          <div className="p-4 space-y-1">
            {settingsCategories.map((category) => (
              <Link
                key={category.id}
                href={category.href}
                className={cn(
                  "block px-4 py-2 rounded-md text-sm font-medium transition-colors",
                  pathname === category.href
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {category.label}
              </Link>
            ))}
          </div>
        </ScrollArea>
      </div>
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="max-w-3xl p-6">{children}</div>
        </ScrollArea>
      </div>
    </div>
  )
}
