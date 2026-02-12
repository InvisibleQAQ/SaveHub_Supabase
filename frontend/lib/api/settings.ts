/**
 * Settings API client for FastAPI backend.
 * Uses HttpOnly cookies for authentication.
 */

import type { RSSReaderState } from "../types"
import { fetchWithAuth } from "./fetch-client"

type Settings = RSSReaderState["settings"]

const API_BASE = "/api/backend/settings"

export interface ApiError {
  detail: string
}

export interface SettingsResponse extends Settings {
  userId?: string
  updatedAt?: Date
}

/**
 * Transform backend snake_case settings to frontend camelCase.
 */
function transformSettings(raw: Record<string, unknown>): SettingsResponse {
  return {
    theme: (raw.theme as string) ?? "system",
    fontSize: (raw.font_size as number) ?? 16,
    autoRefresh: (raw.auto_refresh as boolean) ?? true,
    refreshInterval: (raw.refresh_interval as number) ?? 30,
    articlesRetentionDays: (raw.articles_retention_days as number) ?? 30,
    markAsReadOnScroll: (raw.mark_as_read_on_scroll as boolean) ?? false,
    showThumbnails: (raw.show_thumbnails as boolean) ?? true,
    sidebarPinned: (raw.sidebar_pinned as boolean) ?? false,
    githubToken: raw.github_token as string | undefined,

    agenticRagTopK: (raw.agentic_rag_top_k as number) ?? 10,
    agenticRagMinScore: (raw.agentic_rag_min_score as number) ?? 0.22,
    agenticRagMaxSplitQuestions: (raw.agentic_rag_max_split_questions as number) ?? 3,
    agenticRagMaxToolRoundsPerQuestion:
      (raw.agentic_rag_max_tool_rounds_per_question as number) ?? 3,
    agenticRagMaxExpandCallsPerQuestion:
      (raw.agentic_rag_max_expand_calls_per_question as number) ?? 2,
    agenticRagRetryToolOnFailure:
      (raw.agentic_rag_retry_tool_on_failure as boolean) ?? true,
    agenticRagMaxToolRetry: (raw.agentic_rag_max_tool_retry as number) ?? 1,
    agenticRagAnswerMaxTokens: (raw.agentic_rag_answer_max_tokens as number) ?? 900,

    agenticRagHistorySummaryTemperature:
      (raw.agentic_rag_history_summary_temperature as number) ?? 0.1,
    agenticRagHistorySummaryMaxTokens:
      (raw.agentic_rag_history_summary_max_tokens as number) ?? 160,
    agenticRagQueryAnalysisTemperature:
      (raw.agentic_rag_query_analysis_temperature as number) ?? 0.1,
    agenticRagQueryAnalysisMaxTokens:
      (raw.agentic_rag_query_analysis_max_tokens as number) ?? 320,
    agenticRagAnswerGenerationTemperature:
      (raw.agentic_rag_answer_generation_temperature as number) ?? 0.2,
    agenticRagAggregationTemperature:
      (raw.agentic_rag_aggregation_temperature as number) ?? 0.2,

    agenticRagExpandContextWindowSize:
      (raw.agentic_rag_expand_context_window_size as number) ?? 2,
    agenticRagExpandContextTopKMin:
      (raw.agentic_rag_expand_context_top_k_min as number) ?? 4,
    agenticRagExpandContextMinScoreDelta:
      (raw.agentic_rag_expand_context_min_score_delta as number) ?? -0.1,
    agenticRagRetrySearchMinScoreDelta:
      (raw.agentic_rag_retry_search_min_score_delta as number) ?? -0.15,
    agenticRagSeedSourceLimit:
      (raw.agentic_rag_seed_source_limit as number) ?? 8,

    agenticRagFinalizeMinSources:
      (raw.agentic_rag_finalize_min_sources as number) ?? 5,
    agenticRagFinalizeMinHighConfidence:
      (raw.agentic_rag_finalize_min_high_confidence as number) ?? 1,
    agenticRagEvidenceMaxSources:
      (raw.agentic_rag_evidence_max_sources as number) ?? 12,
    agenticRagEvidenceSnippetMaxChars:
      (raw.agentic_rag_evidence_snippet_max_chars as number) ?? 380,
    agenticRagSourceContentMaxChars:
      (raw.agentic_rag_source_content_max_chars as number) ?? 700,

    agenticRagQueryAnalysisSystemPrompt:
      (raw.agentic_rag_query_analysis_system_prompt as string) ?? "",
    agenticRagClarificationPrompt:
      (raw.agentic_rag_clarification_prompt as string) ?? "",
    agenticRagAnswerGenerationSystemPrompt:
      (raw.agentic_rag_answer_generation_system_prompt as string) ?? "",
    agenticRagAggregationSystemPrompt:
      (raw.agentic_rag_aggregation_system_prompt as string) ?? "",
    agenticRagNoKbAnswer: (raw.agentic_rag_no_kb_answer as string) ?? "知识库暂无相关信息。",
    agenticRagHistorySummarySystemPrompt:
      (raw.agentic_rag_history_summary_system_prompt as string) ?? "你是精炼总结助手。",
    agenticRagHistorySummaryUserPromptTemplate:
      (raw.agentic_rag_history_summary_user_prompt_template as string) ?? "",

    userId: raw.user_id as string | undefined,
    updatedAt: raw.updated_at ? new Date(raw.updated_at as string) : undefined,
  }
}

/**
 * Transform frontend camelCase settings to backend snake_case.
 */
function toApiFormat(settings: Partial<Settings>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (settings.theme !== undefined) result.theme = settings.theme
  if (settings.fontSize !== undefined) result.font_size = settings.fontSize
  if (settings.autoRefresh !== undefined) result.auto_refresh = settings.autoRefresh
  if (settings.refreshInterval !== undefined) result.refresh_interval = settings.refreshInterval
  if (settings.articlesRetentionDays !== undefined) result.articles_retention_days = settings.articlesRetentionDays
  if (settings.markAsReadOnScroll !== undefined) result.mark_as_read_on_scroll = settings.markAsReadOnScroll
  if (settings.showThumbnails !== undefined) result.show_thumbnails = settings.showThumbnails
  if (settings.sidebarPinned !== undefined) result.sidebar_pinned = settings.sidebarPinned
  // Support explicit null to delete token
  if ('githubToken' in settings) result.github_token = settings.githubToken ?? null

  if (settings.agenticRagTopK !== undefined) result.agentic_rag_top_k = settings.agenticRagTopK
  if (settings.agenticRagMinScore !== undefined) result.agentic_rag_min_score = settings.agenticRagMinScore
  if (settings.agenticRagMaxSplitQuestions !== undefined) result.agentic_rag_max_split_questions = settings.agenticRagMaxSplitQuestions
  if (settings.agenticRagMaxToolRoundsPerQuestion !== undefined) result.agentic_rag_max_tool_rounds_per_question = settings.agenticRagMaxToolRoundsPerQuestion
  if (settings.agenticRagMaxExpandCallsPerQuestion !== undefined) result.agentic_rag_max_expand_calls_per_question = settings.agenticRagMaxExpandCallsPerQuestion
  if (settings.agenticRagRetryToolOnFailure !== undefined) result.agentic_rag_retry_tool_on_failure = settings.agenticRagRetryToolOnFailure
  if (settings.agenticRagMaxToolRetry !== undefined) result.agentic_rag_max_tool_retry = settings.agenticRagMaxToolRetry
  if (settings.agenticRagAnswerMaxTokens !== undefined) result.agentic_rag_answer_max_tokens = settings.agenticRagAnswerMaxTokens

  if (settings.agenticRagHistorySummaryTemperature !== undefined) result.agentic_rag_history_summary_temperature = settings.agenticRagHistorySummaryTemperature
  if (settings.agenticRagHistorySummaryMaxTokens !== undefined) result.agentic_rag_history_summary_max_tokens = settings.agenticRagHistorySummaryMaxTokens
  if (settings.agenticRagQueryAnalysisTemperature !== undefined) result.agentic_rag_query_analysis_temperature = settings.agenticRagQueryAnalysisTemperature
  if (settings.agenticRagQueryAnalysisMaxTokens !== undefined) result.agentic_rag_query_analysis_max_tokens = settings.agenticRagQueryAnalysisMaxTokens
  if (settings.agenticRagAnswerGenerationTemperature !== undefined) result.agentic_rag_answer_generation_temperature = settings.agenticRagAnswerGenerationTemperature
  if (settings.agenticRagAggregationTemperature !== undefined) result.agentic_rag_aggregation_temperature = settings.agenticRagAggregationTemperature

  if (settings.agenticRagExpandContextWindowSize !== undefined) result.agentic_rag_expand_context_window_size = settings.agenticRagExpandContextWindowSize
  if (settings.agenticRagExpandContextTopKMin !== undefined) result.agentic_rag_expand_context_top_k_min = settings.agenticRagExpandContextTopKMin
  if (settings.agenticRagExpandContextMinScoreDelta !== undefined) result.agentic_rag_expand_context_min_score_delta = settings.agenticRagExpandContextMinScoreDelta
  if (settings.agenticRagRetrySearchMinScoreDelta !== undefined) result.agentic_rag_retry_search_min_score_delta = settings.agenticRagRetrySearchMinScoreDelta
  if (settings.agenticRagSeedSourceLimit !== undefined) result.agentic_rag_seed_source_limit = settings.agenticRagSeedSourceLimit

  if (settings.agenticRagFinalizeMinSources !== undefined) result.agentic_rag_finalize_min_sources = settings.agenticRagFinalizeMinSources
  if (settings.agenticRagFinalizeMinHighConfidence !== undefined) result.agentic_rag_finalize_min_high_confidence = settings.agenticRagFinalizeMinHighConfidence
  if (settings.agenticRagEvidenceMaxSources !== undefined) result.agentic_rag_evidence_max_sources = settings.agenticRagEvidenceMaxSources
  if (settings.agenticRagEvidenceSnippetMaxChars !== undefined) result.agentic_rag_evidence_snippet_max_chars = settings.agenticRagEvidenceSnippetMaxChars
  if (settings.agenticRagSourceContentMaxChars !== undefined) result.agentic_rag_source_content_max_chars = settings.agenticRagSourceContentMaxChars

  if (settings.agenticRagQueryAnalysisSystemPrompt !== undefined) result.agentic_rag_query_analysis_system_prompt = settings.agenticRagQueryAnalysisSystemPrompt
  if (settings.agenticRagClarificationPrompt !== undefined) result.agentic_rag_clarification_prompt = settings.agenticRagClarificationPrompt
  if (settings.agenticRagAnswerGenerationSystemPrompt !== undefined) result.agentic_rag_answer_generation_system_prompt = settings.agenticRagAnswerGenerationSystemPrompt
  if (settings.agenticRagAggregationSystemPrompt !== undefined) result.agentic_rag_aggregation_system_prompt = settings.agenticRagAggregationSystemPrompt
  if (settings.agenticRagNoKbAnswer !== undefined) result.agentic_rag_no_kb_answer = settings.agenticRagNoKbAnswer
  if (settings.agenticRagHistorySummarySystemPrompt !== undefined) result.agentic_rag_history_summary_system_prompt = settings.agenticRagHistorySummarySystemPrompt
  if (settings.agenticRagHistorySummaryUserPromptTemplate !== undefined) result.agentic_rag_history_summary_user_prompt_template = settings.agenticRagHistorySummaryUserPromptTemplate

  return result
}

/**
 * Get user settings.
 * Returns default settings if none exist.
 */
export async function getSettings(): Promise<SettingsResponse> {
  const response = await fetchWithAuth(API_BASE, {
    method: "GET",
  })

  if (!response.ok) {
    const error: ApiError = await response.json()
    throw new Error(error.detail || "Failed to get settings")
  }

  const data = await response.json()
  return transformSettings(data)
}

/**
 * Update user settings.
 * Creates settings if they don't exist (upsert).
 * Supports partial updates - only provided fields will be updated.
 */
export async function updateSettings(settings: Partial<Settings>): Promise<SettingsResponse> {
  const apiData = toApiFormat(settings)
  console.log('[Settings API] Sending update:', apiData)

  const response = await fetchWithAuth(API_BASE, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(apiData),
  })

  if (!response.ok) {
    console.error('[Settings API] Update failed:', response.status, response.statusText)
    try {
      const error: ApiError = await response.json()
      console.error('[Settings API] Error details:', error)
      throw new Error(error.detail || "Failed to update settings")
    } catch (e) {
      throw new Error(`Failed to update settings: ${response.status} ${response.statusText}`)
    }
  }

  const data = await response.json()
  console.log('[Settings API] Update success:', data)
  return transformSettings(data)
}

/**
 * Settings API namespace for easy import.
 */
export const settingsApi = {
  getSettings,
  updateSettings,
}
