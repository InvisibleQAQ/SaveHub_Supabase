"use client"

import Link from "next/link"
import { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ViewButtonProps {
  href: string
  icon: LucideIcon
  label: string
  count?: number
  isActive: boolean
  variant: "icon" | "full"
}

export function ViewButton({ href, icon: Icon, label, count, isActive, variant }: ViewButtonProps) {
  if (variant === "icon") {
    return (
      <Button
        variant={isActive ? "secondary" : "ghost"}
        size="icon"
        className={cn(
          "h-10 w-10 flex items-center justify-center",
          isActive && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
        )}
        title={label}
        asChild
      >
        <Link href={href}>
          <Icon className="h-4 w-4" />
        </Link>
      </Button>
    )
  }

  return (
    <Button
      variant={isActive ? "secondary" : "ghost"}
      className={cn(
        "w-full justify-start gap-3 text-sidebar-foreground",
        isActive
          ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
          : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
      asChild
    >
      <Link href={href}>
        <Icon className="h-4 w-4" />
        {label}
        {count !== undefined && count > 0 && (
          <Badge variant="secondary" className="ml-auto bg-sidebar-accent text-sidebar-accent-foreground">
            {count}
          </Badge>
        )}
      </Link>
    </Button>
  )
}