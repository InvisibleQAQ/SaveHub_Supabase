"use client"

import { useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  Monitor,
  Smartphone,
  Globe,
  Terminal,
  Package,
  Apple,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { REPOSITORY_CATEGORIES, type DynamicCategoryItem } from "@/lib/repository-categories"

/** 获取平台图标 - 与 repository-card.tsx 保持一致 */
function getPlatformIcon(platform: string): LucideIcon {
  const p = platform.toLowerCase()
  if (p === "macos" || p === "mac" || p === "ios") return Apple
  if (p === "windows" || p === "win") return Monitor
  if (p === "linux") return Terminal
  if (p === "android") return Smartphone
  if (p === "web") return Globe
  if (p === "cli") return Terminal
  if (p === "docker") return Package
  return Monitor
}

interface CategorySidebarProps {
  selectedCategory: string
  onSelectCategory: (id: string) => void
  counts: Record<string, number>
  platforms: DynamicCategoryItem[]
  tags: DynamicCategoryItem[]
  selectedDynamicFilter: { type: "platform" | "tag"; value: string } | null
  onSelectDynamicFilter: (type: "platform" | "tag", value: string) => void
}

interface CollapsibleSectionProps {
  title: string
  icon: string
  items: DynamicCategoryItem[]
  selectedValue: string | null
  onSelect: (value: string) => void
  defaultVisibleCount?: number
  getItemIcon?: (value: string) => LucideIcon
}

function CollapsibleSection({
  title,
  icon,
  items,
  selectedValue,
  onSelect,
  defaultVisibleCount = 10,
  getItemIcon,
}: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const visibleItems = isExpanded ? items : items.slice(0, defaultVisibleCount)
  const hasMore = items.length > defaultVisibleCount

  return (
    <div className="mt-4 space-y-1">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2 flex items-center gap-2">
        <span>{icon}</span>
        {title}
      </h3>

      {visibleItems.map((item) => {
        const ItemIcon = getItemIcon?.(item.value)
        return (
          <button
            key={item.value}
            onClick={() => onSelect(item.value)}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all duration-150",
              selectedValue === item.value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground hover:bg-muted/80"
            )}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {ItemIcon && <ItemIcon className="w-4 h-4 flex-shrink-0" />}
              <span className="truncate">{item.value}</span>
            </div>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full font-medium min-w-[1.5rem] text-center ml-2",
                selectedValue === item.value
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {item.count}
            </span>
          </button>
        )
      })}

      {hasMore && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronDown className="w-3 h-3" />
              收起
            </>
          ) : (
            <>
              <ChevronRight className="w-3 h-3" />
              显示全部 {items.length} 个
            </>
          )}
        </button>
      )}
    </div>
  )
}

export function CategorySidebar({
  selectedCategory,
  onSelectCategory,
  counts,
  platforms,
  tags,
  selectedDynamicFilter,
  onSelectDynamicFilter,
}: CategorySidebarProps) {
  return (
    <div className="w-56 flex-shrink-0 space-y-1">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">
        分类
      </h3>
      {REPOSITORY_CATEGORIES.map((category) => {
        const count = counts[category.id] || 0
        const isSelected = selectedCategory === category.id && !selectedDynamicFilter

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

      {/* Platform 分类 */}
      {platforms.length > 0 && (
        <CollapsibleSection
          title="平台"
          icon="💻"
          items={platforms}
          selectedValue={selectedDynamicFilter?.type === "platform" ? selectedDynamicFilter.value : null}
          onSelect={(value) => onSelectDynamicFilter("platform", value)}
          getItemIcon={getPlatformIcon}
        />
      )}

      {/* Tags 分类 */}
      {tags.length > 0 && (
        <CollapsibleSection
          title="标签"
          icon="🏷️"
          items={tags}
          selectedValue={selectedDynamicFilter?.type === "tag" ? selectedDynamicFilter.value : null}
          onSelect={(value) => onSelectDynamicFilter("tag", value)}
        />
      )}
    </div>
  )
}
