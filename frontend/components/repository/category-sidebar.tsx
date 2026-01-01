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
      <h3 className="text-sm font-medium text-muted-foreground px-3 py-2">
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
              "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors",
              isSelected
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-muted"
            )}
          >
            <div className="flex items-center gap-2">
              <span>{category.icon}</span>
              <span>{category.name}</span>
            </div>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full",
                isSelected ? "bg-primary/20" : "bg-muted"
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
