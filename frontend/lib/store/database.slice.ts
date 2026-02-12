import type { StateCreator } from "zustand"
import { authApi } from "../api/auth"
import { foldersApi } from "../api/folders"
import { feedsApi } from "../api/feeds"
import { articlesApi } from "../api/articles"
import { settingsApi } from "../api/settings"
import { repositoriesApi } from "../api/repositories"

// Default settings for new users
const defaultSettings = {
  theme: "system" as const,
  fontSize: 16,
  autoRefresh: true,
  refreshInterval: 30,
  articlesRetentionDays: 30,
  markAsReadOnScroll: false,
  showThumbnails: true,
  sidebarPinned: false,

  agenticRagTopK: 10,
  agenticRagMinScore: 0.35,
  agenticRagMaxSplitQuestions: 3,
  agenticRagMaxToolRoundsPerQuestion: 3,
  agenticRagMaxExpandCallsPerQuestion: 2,
  agenticRagRetryToolOnFailure: true,
  agenticRagMaxToolRetry: 1,
  agenticRagAnswerMaxTokens: 900,

  agenticRagHistorySummaryTemperature: 0.1,
  agenticRagHistorySummaryMaxTokens: 160,
  agenticRagQueryAnalysisTemperature: 0.1,
  agenticRagQueryAnalysisMaxTokens: 320,
  agenticRagAnswerGenerationTemperature: 0.2,
  agenticRagAggregationTemperature: 0.2,

  agenticRagExpandContextWindowSize: 2,
  agenticRagExpandContextTopKMin: 4,
  agenticRagExpandContextMinScoreDelta: -0.1,
  agenticRagRetrySearchMinScoreDelta: -0.15,
  agenticRagSeedSourceLimit: 8,

  agenticRagFinalizeMinSources: 5,
  agenticRagFinalizeMinHighConfidence: 1,
  agenticRagEvidenceMaxSources: 12,
  agenticRagEvidenceSnippetMaxChars: 380,
  agenticRagSourceContentMaxChars: 700,

  agenticRagQueryAnalysisSystemPrompt: `你是资深的 RAG 查询分析器。

你的职责：把用户问题改写成适合语义检索的自包含子问题，并判断是否需要澄清。

硬性规则：
1. 只能基于用户输入与对话历史，不得编造实体或条件。
2. 问题不清楚时必须标记为不清晰，并给出中文澄清问题。
3. 如果有多个独立信息需求，可拆成最多 3 个子问题。
4. 每个子问题都必须可直接检索，不允许“这个/那个/它”这类指代。

请只输出 JSON（不要 markdown），结构必须是：
{
  "is_clear": true,
  "questions": ["..."],
  "clarification_needed": "...",
  "reason": "..."
}

字段约束：
- is_clear: 布尔值
- questions: 字符串数组；is_clear=true 时至少 1 条
- clarification_needed: is_clear=false 时必须是可直接发给用户的中文追问
- reason: 20 字以内，用于日志简述`,
  agenticRagClarificationPrompt: "我还缺少关键信息。请补充你想查询的对象、时间范围、比较维度或具体场景。",
  agenticRagAnswerGenerationSystemPrompt: `你是严格证据驱动的知识库问答助手。

你只能基于“检索证据”回答，禁止使用外部常识补全。

输出规则：
1. 每个关键结论后必须带引用标记 [ref:N]（N 来自证据编号）。
2. 不允许引用不存在的编号。
3. 若证据不足以回答，必须明确说“知识库暂无相关信息”。
4. 回答用中文，简洁且信息完整。`,
  agenticRagAggregationSystemPrompt: `你是多子问题答案聚合助手。

目标：把多个基于证据的答案整合成一段自然、完整、去重的最终回答。

规则：
1. 只使用输入答案里的事实，不新增外部知识。
2. 保留并复用原有 [ref:N] 引用。
3. 若不同答案重复，进行合并；若冲突，保留冲突并说明。
4. 若所有子答案都缺乏信息，输出“知识库暂无相关信息”。`,
  agenticRagNoKbAnswer: "知识库暂无相关信息。",
  agenticRagHistorySummarySystemPrompt: "你是精炼总结助手。",
  agenticRagHistorySummaryUserPromptTemplate:
    "你是对话摘要助手。请把以下历史对话压缩为 1-2 句中文摘要，保留主题、关键实体和未解决问题。只输出摘要正文。",
}

export interface DatabaseSlice {
  isDatabaseReady: boolean
  setDatabaseReady: (ready: boolean) => void
  checkDatabaseStatus: () => Promise<boolean>
  syncToSupabase: () => Promise<void>
  loadFromSupabase: () => Promise<void>
}

export const createDatabaseSlice: StateCreator<
  any,
  [],
  [],
  DatabaseSlice
> = (set, get) => ({
  isDatabaseReady: false,

  checkDatabaseStatus: async () => {
    try {
      // Check if user is authenticated via FastAPI backend
      const session = await authApi.getSession()
      const isReady = session.authenticated
      set({ isDatabaseReady: isReady } as any)
      return isReady
    } catch (error) {
      console.error("Error checking database status:", error)
      set({ isDatabaseReady: false } as any)
      return false
    }
  },

  setDatabaseReady: (ready) => {
    set({ isDatabaseReady: ready } as any)
  },

  syncToSupabase: async () => {
    // Note: Individual slices now sync data on each operation
    // This method is kept for backward compatibility but does nothing
    // because data is already synced via API calls in each slice action
    const state = get() as any
    if (!state.isDatabaseReady) {
      return
    }
    // No-op: Data is synced in real-time by individual slice actions
  },

  loadFromSupabase: async () => {
    const isReady = await (get() as any).checkDatabaseStatus()

    if (!isReady) {
      set({
        isLoading: false,
        error: null,
      } as any)
      return
    }

    try {
      set({ isLoading: true } as any)

      // Load all data from FastAPI backend in parallel
      const [folders, feeds, articles, settings, repositories] = await Promise.all([
        foldersApi.getFolders(),
        feedsApi.getFeeds(),
        articlesApi.getArticles(),
        settingsApi.getSettings().catch(() => null),
        repositoriesApi.getAll().catch(() => []),
      ])

      console.log('[Store] Loaded data via API')

      set({
        folders: folders || [],
        feeds: feeds || [],
        articles: articles || [],
        repositories: repositories || [],
        settings: settings || defaultSettings,
        apiConfigsGrouped: { chat: [], embedding: [], rerank: [] },
        isLoading: false,
      } as any)

      // Clear old articles based on retention settings
      const retentionDays = settings?.articlesRetentionDays || 30
      const result = await articlesApi.clearOldArticles(retentionDays)

      if (result.deletedCount > 0) {
        // Reload articles after cleanup
        const updatedArticles = await articlesApi.getArticles()
        set({ articles: updatedArticles || [] } as any)
      }
    } catch (error) {
      console.error("Failed to load from API:", error)
      set({
        error: "Failed to load saved data",
        isLoading: false,
      } as any)
    }
  },
})
