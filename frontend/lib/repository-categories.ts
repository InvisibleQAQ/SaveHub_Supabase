/**
 * Repository categories definition and matching logic
 */

import type { Repository, RepositoryCategory } from "./types"

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
 * Match a repository to a category based on keywords
 */
export function matchCategory(repo: Repository): string {
  const searchText = [
    repo.name,
    repo.fullName,
    repo.description || "",
    repo.language || "",
    ...(repo.topics || []),
  ].join(" ").toLowerCase()

  for (const category of REPOSITORY_CATEGORIES) {
    if (category.id === "all") continue

    const hasMatch = category.keywords.some(keyword =>
      searchText.includes(keyword.toLowerCase())
    )

    if (hasMatch) {
      return category.id
    }
  }

  return "all"
}

/**
 * Get category counts for all repositories
 */
export function getCategoryCounts(repos: Repository[]): Record<string, number> {
  const counts: Record<string, number> = { all: repos.length }

  for (const category of REPOSITORY_CATEGORIES) {
    if (category.id === "all") continue
    counts[category.id] = 0
  }

  for (const repo of repos) {
    const categoryId = matchCategory(repo)
    if (categoryId !== "all") {
      counts[categoryId] = (counts[categoryId] || 0) + 1
    }
  }

  return counts
}

/**
 * Filter repositories by category
 */
export function filterByCategory(repos: Repository[], categoryId: string): Repository[] {
  if (categoryId === "all") return repos

  return repos.filter(repo => matchCategory(repo) === categoryId)
}
