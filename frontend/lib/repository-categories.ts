/**
 * Repository categories definition and matching logic
 */

import type { Repository, RepositoryCategory } from "./types"

/** 动态分类项 */
export interface DynamicCategoryItem {
  value: string
  count: number
}

/**
 * 标准化字符串用于匹配比较
 * - 转小写
 * - 移除空格和连字符
 */
function normalizeForMatch(str: string): string {
  return str.toLowerCase().replace(/[\s-]/g, "")
}

export const REPOSITORY_CATEGORIES: RepositoryCategory[] = [
  { id: "all", name: "全部分类", icon: "📁", keywords: [] },
  { id: "web", name: "Web应用", icon: "🌐", keywords: ["web", "frontend", "react", "vue", "angular", "nextjs", "nuxt"] },
  { id: "mobile", name: "移动应用", icon: "📱", keywords: ["mobile", "android", "ios", "flutter", "react-native", "swift", "kotlin"] },
  { id: "desktop", name: "桌面应用", icon: "💻", keywords: ["desktop", "electron", "tauri", "gui", "qt", "gtk"] },
  { id: "database", name: "数据库", icon: "🗄️", keywords: ["database", "sql", "nosql", "mongodb", "postgres", "mysql", "redis"] },
  { id: "ai", name: "AI/机器学习", icon: "🤖", keywords: ["ai", "ml", "machine-learning", "deep-learning", "llm", "gpt", "neural", "tensorflow", "pytorch"] },
  { id: "devtools", name: "开发工具", icon: "🔧", keywords: ["tool", "cli", "build", "test", "lint", "debug", "devtool"] },
  { id: "security", name: "安全工具", icon: "🛡️", keywords: ["security", "encryption", "auth", "crypto", "pentest", "vulnerability"] },
  { id: "game", name: "游戏", icon: "🎮", keywords: ["game", "gaming", "unity", "unreal", "godot", "gamedev"] },
  { id: "design", name: "设计工具", icon: "🎨", keywords: ["design", "ui", "ux", "graphics", "figma", "sketch", "icon"] },
  { id: "productivity", name: "效率工具", icon: "⚡", keywords: ["productivity", "note", "todo", "automation", "workflow"] },
  { id: "education", name: "教育学习", icon: "📚", keywords: ["education", "learning", "tutorial", "course", "book", "documentation"] },
  { id: "social", name: "社交网络", icon: "👥", keywords: ["social", "chat", "messaging", "community", "forum"] },
  { id: "analytics", name: "数据分析", icon: "📊", keywords: ["analytics", "data", "visualization", "chart", "dashboard", "metrics"] },
]

/**
 * 匹配仓库到所有符合条件的分类
 * @returns 匹配的分类 ID 数组（不包含 "all"）
 */
export function matchCategories(repo: Repository): string[] {
  // 1. 收集所有匹配源并标准化
  const matchSources: string[] = []

  // 基础字段
  if (repo.name) matchSources.push(normalizeForMatch(repo.name))
  if (repo.fullName) matchSources.push(normalizeForMatch(repo.fullName))
  if (repo.description) matchSources.push(normalizeForMatch(repo.description))
  if (repo.language) matchSources.push(normalizeForMatch(repo.language))

  // 数组字段
  for (const topic of repo.topics || []) {
    matchSources.push(normalizeForMatch(topic))
  }
  for (const tag of repo.aiTags || []) {
    matchSources.push(normalizeForMatch(tag))
  }
  for (const platform of repo.aiPlatforms || []) {
    matchSources.push(normalizeForMatch(platform))
  }
  for (const tag of repo.customTags || []) {
    matchSources.push(normalizeForMatch(tag))
  }
  if (repo.customCategory) {
    matchSources.push(normalizeForMatch(repo.customCategory))
  }

  // 2. 合并为搜索文本
  const searchText = matchSources.join(" ")

  // 3. 收集所有匹配的分类
  const matchedCategories: string[] = []

  for (const category of REPOSITORY_CATEGORIES) {
    if (category.id === "all") continue

    const hasMatch = category.keywords.some(keyword => {
      const normalizedKeyword = normalizeForMatch(keyword)
      return searchText.includes(normalizedKeyword)
    })

    if (hasMatch) {
      matchedCategories.push(category.id)
    }
  }

  return matchedCategories
}

/**
 * Match a repository to a category based on keywords
 * @deprecated 使用 matchCategories() 获取所有匹配分类
 */
export function matchCategory(repo: Repository): string {
  const categories = matchCategories(repo)
  return categories.length > 0 ? categories[0] : "all"
}

/**
 * Get category counts for all repositories
 * 注意：一个仓库可能被多个分类计数
 */
export function getCategoryCounts(repos: Repository[]): Record<string, number> {
  const counts: Record<string, number> = { all: repos.length }

  for (const category of REPOSITORY_CATEGORIES) {
    if (category.id === "all") continue
    counts[category.id] = 0
  }

  for (const repo of repos) {
    const matchedCategories = matchCategories(repo)
    for (const categoryId of matchedCategories) {
      counts[categoryId]++
    }
  }

  return counts
}

/**
 * Filter repositories by category
 * 仓库只要匹配该分类即可（不要求唯一匹配）
 */
export function filterByCategory(repos: Repository[], categoryId: string): Repository[] {
  if (categoryId === "all") return repos

  return repos.filter(repo => {
    const matchedCategories = matchCategories(repo)
    return matchedCategories.includes(categoryId)
  })
}

/**
 * 聚合仓库的指定字段值，按出现次数降序排序
 */
function aggregateField(
  repos: Repository[],
  extractor: (repo: Repository) => string[]
): DynamicCategoryItem[] {
  const countMap = new Map<string, number>()

  for (const repo of repos) {
    const values = extractor(repo)
    for (const value of values) {
      if (value) {
        countMap.set(value, (countMap.get(value) || 0) + 1)
      }
    }
  }

  return Array.from(countMap.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
}

/** 聚合所有 platforms */
export function getPlatformCounts(repos: Repository[]): DynamicCategoryItem[] {
  return aggregateField(repos, (repo) => repo.aiPlatforms || [])
}

/** 聚合所有 tags (ai_tags + custom_tags 合并) */
export function getTagCounts(repos: Repository[]): DynamicCategoryItem[] {
  return aggregateField(repos, (repo) => [
    ...(repo.aiTags || []),
    ...(repo.customTags || []),
  ])
}

/** 按动态分类过滤仓库 */
export function filterByDynamic(
  repos: Repository[],
  type: "platform" | "tag",
  value: string
): Repository[] {
  return repos.filter((repo) => {
    if (type === "platform") {
      return repo.aiPlatforms?.includes(value)
    } else {
      return repo.aiTags?.includes(value) || repo.customTags?.includes(value)
    }
  })
}
