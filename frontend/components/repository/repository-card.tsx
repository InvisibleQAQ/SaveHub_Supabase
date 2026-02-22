"use client"

import { useState, useRef, useEffect } from "react"
import {
  Star,
  ExternalLink,
  Calendar,
  Bot,
  Edit3,
  BookOpen,
  Monitor,
  Smartphone,
  Globe,
  Terminal,
  Package,
  Apple,
  TrendingUp,
} from "lucide-react"
import type { Repository } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
import { enUS, zhCN } from "date-fns/locale"
import { getLanguageColor } from "@/lib/language-colors"
import { useRSSStore } from "@/lib/store"
import { useToast } from "@/hooks/use-toast"
import { RepositoryEditModal } from "./repository-edit-modal"
import { useLocale, useTranslations } from "next-intl"

interface RepositoryCardProps {
  repository: Repository
  onClick?: () => void
  searchQuery?: string
}

export function RepositoryCard({
  repository,
  onClick,
  searchQuery = "",
}: RepositoryCardProps) {
  const t = useTranslations("repository")
  const locale = useLocale()
  const { analyzeRepository, isAnalyzing } = useRSSStore()
  const { toast } = useToast()

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [isTextTruncated, setIsTextTruncated] = useState(false)
  const descriptionRef = useRef<HTMLParagraphElement>(null)

  const languageColor = getLanguageColor(repository.language)

  // Check if text is truncated
  useEffect(() => {
    const checkTruncation = () => {
      if (descriptionRef.current) {
        const element = descriptionRef.current
        setIsTextTruncated(element.scrollHeight > element.clientHeight)
      }
    }
    checkTruncation()
    window.addEventListener("resize", checkTruncation)
    return () => window.removeEventListener("resize", checkTruncation)
  }, [repository])

  // Format number (1000 -> 1K)
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  // Get platform icon
  const getPlatformIcon = (platform: string) => {
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

  // Get display content (custom > AI > original)
  const getDisplayContent = () => {
    if (repository.customDescription) {
      return { content: repository.customDescription, isCustom: true, isAI: false }
    }
    if (repository.analysisFailed) {
      return { content: repository.description || t("card.noDescription"), isCustom: false, isAI: false, isFailed: true }
    }
    if (repository.aiSummary) {
      return { content: repository.aiSummary, isCustom: false, isAI: true }
    }
    return { content: repository.description || t("card.noDescription"), isCustom: false, isAI: false }
  }

  // Get display tags (merge all sources with deduplication)
  const getDisplayTags = () => {
    const result: Array<{ tag: string; source: 'custom' | 'ai' | 'topic' }> = []
    const seen = new Set<string>()

    const customTags = repository.customTags || []
    const aiTags = repository.aiTags || []
    const topics = repository.topics || []

    for (const tag of customTags) {
      const normalized = tag.toLowerCase()
      if (!seen.has(normalized)) {
        seen.add(normalized)
        result.push({ tag, source: 'custom' })
      }
    }

    for (const tag of aiTags) {
      const normalized = tag.toLowerCase()
      if (!seen.has(normalized)) {
        seen.add(normalized)
        result.push({ tag, source: 'ai' })
      }
    }

    for (const tag of topics) {
      const normalized = tag.toLowerCase()
      if (!seen.has(normalized)) {
        seen.add(normalized)
        result.push({ tag, source: 'topic' })
      }
    }

    return result
  }

  // Handle AI analyze
  const handleAIAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await analyzeRepository(repository.id)
      toast({ title: t("toast.aiAnalyzeCompleted") })
    } catch (error) {
      toast({
        title: t("toast.aiAnalyzeFailed"),
        description: error instanceof Error ? error.message : t("toast.unknownError"),
        variant: "destructive",
      })
    }
  }

  // Get Zread URL
  const getZreadUrl = () => `https://zread.ai/${repository.fullName}`

  const displayContent = getDisplayContent()
  const displayTags = getDisplayTags()
  const updatedAt = repository.githubUpdatedAt
    ? formatDistanceToNow(new Date(repository.githubUpdatedAt), {
        addSuffix: true,
        locale: locale === "zh" ? zhCN : enUS,
      })
    : null

  return (
    <div
      className="bg-card border rounded-xl p-5 hover:shadow-lg transition-all duration-200 hover:border-primary/30 flex flex-col h-full"
      onClick={onClick}
    >
      {/* Header - Repository Info */}
      <div className="flex items-center gap-3 mb-3">
        {repository.ownerAvatarUrl && (
          <img
            src={repository.ownerAvatarUrl}
            alt={repository.ownerLogin}
            className="w-8 h-8 rounded-full flex-shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground truncate">{repository.name}</h3>
          <p className="text-sm text-muted-foreground truncate">{repository.ownerLogin}</p>
        </div>
      </div>

      {/* Action Buttons Row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {/* AI Analyze Button */}
          <button
            onClick={handleAIAnalyze}
            disabled={isAnalyzing}
            className={`p-2 rounded-lg transition-colors ${
              repository.analysisFailed
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : repository.analyzedAt
                ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200"
                : "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 hover:bg-purple-200"
            } disabled:opacity-50`}
            title={
              repository.analysisFailed
                ? t("card.tooltipAnalyzeRetryFailed")
                : repository.analyzedAt
                  ? t("card.tooltipAnalyzeAgain")
                  : t("card.tooltipAnalyze")
            }
          >
            <Bot className="w-4 h-4" />
          </button>
          {/* Edit Button */}
          <button
            onClick={(e) => { e.stopPropagation(); setEditModalOpen(true) }}
            className="p-2 rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 hover:bg-orange-200 transition-colors"
            title={t("card.tooltipEdit")}
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* Zread Link */}
          <a
            href={getZreadUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-2 rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 hover:bg-indigo-200 transition-colors"
            title={t("card.tooltipViewInZread")}
          >
            <BookOpen className="w-4 h-4" />
          </a>
          {/* GitHub Link */}
          <a
            href={repository.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-2 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
            title={t("card.tooltipViewOnGitHub")}
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Description with Tooltip */}
      <div className="mb-4 flex-1">
        <div
          className="relative"
          onMouseEnter={() => isTextTruncated && setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <p
            ref={descriptionRef}
            className="text-muted-foreground text-sm leading-relaxed line-clamp-3 mb-2"
          >
            {displayContent.content}
          </p>
          {/* Tooltip */}
          {isTextTruncated && showTooltip && (
            <div className="absolute z-50 bottom-full left-0 right-0 mb-2 p-3 bg-popover text-popover-foreground text-sm rounded-lg shadow-lg border max-h-48 overflow-y-auto">
              {displayContent.content}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {displayContent.isCustom && (
            <span className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
              <Edit3 className="w-3 h-3" />
              {t("card.badgeCustom")}
            </span>
          )}
          {displayContent.isAI && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <Bot className="w-3 h-3" />
              {t("card.badgeAiSummary")}
            </span>
          )}
        </div>
      </div>

      {/* Category Display */}
      {repository.customCategory && (
        <div className="mb-3">
          <span className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-md text-xs font-medium">
            {repository.customCategory}
          </span>
        </div>
      )}

      {/* Tags */}
      {displayTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {displayTags.map((item, index) => (
            <span
              key={index}
              className={`px-2 py-0.5 text-xs rounded-md font-medium ${
                item.source === 'custom'
                  ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                  : item.source === 'ai'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-primary/10 text-primary/80'
              }`}
            >
              {item.tag}
            </span>
          ))}
        </div>
      )}

      {/* Platform Icons */}
      {repository.aiPlatforms && repository.aiPlatforms.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-muted-foreground">{t("card.platformSupported")}</span>
          <div className="flex gap-1">
            {repository.aiPlatforms.slice(0, 6).map((platform, index) => {
              const IconComponent = getPlatformIcon(platform)
              return (
                <div
                  key={index}
                  className="w-6 h-6 flex items-center justify-center bg-muted rounded text-muted-foreground"
                  title={platform}
                >
                  <IconComponent className="w-3 h-3" />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="space-y-3 mt-auto">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            {repository.language && (
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: languageColor }}
                />
                <span className="truncate max-w-20">{repository.language}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Star className="w-4 h-4 text-amber-500" />
              {formatNumber(repository.stargazersCount)}
            </span>
            {repository.openrank != null && (
              <span className="flex items-center gap-1" title={t("card.openRankScore")}>
                <TrendingUp className="w-4 h-4 text-blue-500" />
                {repository.openrank.toFixed(2)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {repository.lastEdited && (
              <span className="flex items-center gap-1 text-xs">
                <Edit3 className="w-3 h-3 text-orange-500" />
                {t("card.badgeEdited")}
              </span>
            )}
            {repository.analysisFailed ? (
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 bg-destructive rounded-full" />
                {t("card.badgeAnalyzeFailed")}
              </span>
            ) : repository.analyzedAt && (
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 bg-green-500 rounded-full" />
                {t("card.badgeAiAnalyzed")}
              </span>
            )}
          </div>
        </div>

        {/* Update Time */}
        {updatedAt && (
          <div className="flex items-center text-sm text-muted-foreground pt-2 border-t">
            <Calendar className="w-4 h-4 mr-1 flex-shrink-0" />
            <span className="truncate">{t("card.updatedAt", { time: updatedAt })}</span>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <RepositoryEditModal
        repository={repository}
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
      />
    </div>
  )
}
