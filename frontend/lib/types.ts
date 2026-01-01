import { z } from "zod"

// Added folder schema
export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().default(0),
  createdAt: z.date().default(() => new Date()),
})

// Updated feed schema to include folderId and refreshInterval
export const FeedSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  description: z.string().optional(),
  category: z.string().optional(),
  folderId: z.string().optional(),
  order: z.number().default(0),
  unreadCount: z.number().default(0),
  lastFetched: z.date().optional(),
  refreshInterval: z
    .number()
    .int()
    .min(1, "Refresh interval must be at least 1 minute")
    .max(10080, "Refresh interval cannot exceed 1 week (10080 minutes)")
    .default(60),
  lastFetchStatus: z.enum(["success", "failed"]).nullable().optional(),
  lastFetchError: z.string().nullable().optional(),
  enableDeduplication: z.boolean().default(false),
})

export const ArticleSchema = z.object({
  id: z.string(),
  feedId: z.string(),
  title: z.string(),
  content: z.string(),
  summary: z.string().optional(),
  url: z.string().url(),
  author: z.string().optional(),
  publishedAt: z.date(),
  isRead: z.boolean().default(false),
  isStarred: z.boolean().default(false),
  thumbnail: z.string().optional(),
  contentHash: z.string().optional(), // SHA-256 hash of (title + content), used for deduplication
})

// API Configuration types
export type ApiConfigType = "chat" | "embedding" | "rerank"

// API Configuration schema
export const ApiConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  apiKey: z.string(), // Will be encrypted in database
  apiBase: z.string(), // Will be encrypted in database
  model: z.string(),
  type: z.enum(["chat", "embedding", "rerank"]).default("chat"),
  isActive: z.boolean().default(true),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
})

// Grouped API configs for Tab UI
export interface ApiConfigsGrouped {
  chat: ApiConfig[]
  embedding: ApiConfig[]
  rerank: ApiConfig[]
}

export type Feed = z.infer<typeof FeedSchema>
export type Article = z.infer<typeof ArticleSchema>
export type Folder = z.infer<typeof FolderSchema>
export type ApiConfig = z.infer<typeof ApiConfigSchema>

export interface RSSReaderState {
  folders: Folder[]
  feeds: Feed[]
  articles: Article[]
  apiConfigsGrouped: ApiConfigsGrouped
  selectedFeedId: string | null
  selectedArticleId: string | null
  viewMode: "all" | "unread" | "starred"
  isLoading: boolean
  error: string | null
  searchQuery: string
  isDatabaseReady: boolean
  isSidebarCollapsed: boolean
  settings: {
    theme: string
    fontSize: number
    autoRefresh: boolean
    refreshInterval: number
    articlesRetentionDays: number
    markAsReadOnScroll: boolean
    showThumbnails: boolean
    sidebarPinned: boolean
    githubToken?: string
  }
}

// GitHub Repository types
export interface Repository {
  id: string
  githubId: number
  name: string
  fullName: string
  description: string | null
  htmlUrl: string
  stargazersCount: number
  language: string | null
  topics: string[]
  ownerLogin: string
  ownerAvatarUrl: string | null
  starredAt: string | null
  githubUpdatedAt: string | null
  githubPushedAt: string | null
  readmeContent: string | null
  // AI analysis fields
  aiSummary: string | null
  aiTags: string[]
  aiPlatforms: string[]
  analyzedAt: string | null
  analysisFailed: boolean
  // Custom edit fields
  customDescription: string | null
  customTags: string[]
  customCategory: string | null
  lastEdited: string | null
}

export interface RepositoryCategory {
  id: string
  name: string
  icon: string
  keywords: string[]
}

export interface SyncResult {
  total: number
  newCount: number
  updatedCount: number
}
