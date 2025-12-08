/**
 * Unified API client exports for FastAPI backend.
 * All API modules use HttpOnly cookies for authentication.
 */

// Auth API
export { authApi, login, register, logout, getSession, refreshToken } from "./auth"
export type { AuthUser, SessionResponse, AuthError } from "./auth"

// Feeds API
export { feedsApi, getFeeds, saveFeeds, getFeed, updateFeed, deleteFeed } from "./feeds"
export type { FeedDeleteResponse, FeedCreateResponse, FeedUpdateResponse } from "./feeds"

// Folders API
export { foldersApi, getFolders, saveFolders, updateFolder, deleteFolder } from "./folders"
export type { FolderCreateResponse, FolderUpdateResponse } from "./folders"

// Articles API
export { articlesApi, getArticles, saveArticles, getArticle, updateArticle, clearOldArticles, getArticleStats } from "./articles"
export type { ArticleCreateResponse, ArticleUpdateResponse, ClearOldArticlesResponse, ArticleStats } from "./articles"

// Settings API
export { settingsApi, getSettings, updateSettings } from "./settings"
export type { SettingsResponse } from "./settings"
