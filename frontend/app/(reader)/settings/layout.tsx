"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const settingsCategoryIds = [
  { id: "general", key: "general" as const, href: "/settings/general" },
  { id: "appearance", key: "appearance" as const, href: "/settings/appearance" },
  { id: "rag", key: "rag" as const, href: "/settings/rag" },
  { id: "api", key: "api" as const, href: "/settings/api" },
  { id: "storage", key: "storage" as const, href: "/settings/storage" },
  { id: "github-token", key: "githubToken" as const, href: "/settings/github-token" },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const t = useTranslations("settings.layout")

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-border bg-muted/10">
        <ScrollArea className="h-[calc(100vh-120px)]">
          <div className="p-4 space-y-1">
            {settingsCategoryIds.map((category) => (
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
                {t(category.key)}
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
