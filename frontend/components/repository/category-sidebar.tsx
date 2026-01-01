"use client"

import { cn } from "@/lib/utils"
import { REPOSITORY_CATEGORIES } from "@/lib/repository-categories"

interface CategorySidebarProps {
  selectedCategory: string
  onSelectCategory: (id: string) => void
  counts: Record<string, number>
}

export function CategorySidebar({
  selectedCategory,
  onSelectCategory,
  counts,
}: CategorySidebarProps) {
  return (
    <div className="w-56 flex-shrink-0 space-y-1">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">
        分类
      </h3>
      {REPOSITORY_CATEGORIES.map((category) => {
        const count = counts[category.id] || 0
        const isSelected = selectedCategory === category.id

        return (
          <button
            key={category.id}
            onClick={() => onSelectCategory(category.id)}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all duration-150",
              isSelected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground hover:bg-muted/80"
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-base">{category.icon}</span>
              <span className="font-medium">{category.name}</span>
            </div>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full font-medium min-w-[1.5rem] text-center",
                isSelected
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
