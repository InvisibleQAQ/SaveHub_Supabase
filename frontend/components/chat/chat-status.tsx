"use client"

import { useEffect, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Loader2,
  PenLine,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

export type AgentStageStatus = "pending" | "active" | "completed"

export interface AgentStageProgress {
  rewrite: AgentStageStatus
  toolCall: AgentStageStatus
  expandContext: AgentStageStatus
  aggregation: AgentStageStatus
}

export type AgentStageLogStage = keyof AgentStageProgress | "system"

export interface AgentStageLogEntry {
  id: string
  stage: AgentStageLogStage
  message: string
  timestamp: number
}

interface ChatStatusProps {
  status: string
  stages: AgentStageProgress
  stageLogs: AgentStageLogEntry[]
  defaultCollapsed?: boolean
  isRunning?: boolean
}

function StageIcon({ status }: { status: AgentStageStatus }) {
  if (status === "completed") {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
  }

  if (status === "active") {
    return <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
  }

  return <Circle className="w-3.5 h-3.5 text-muted-foreground/60" />
}

function TimelineStageIcon({ stage }: { stage: AgentStageLogStage }) {
  if (stage === "rewrite") {
    return <PenLine className="w-3.5 h-3.5 text-violet-500" />
  }

  if (stage === "toolCall") {
    return <Wrench className="w-3.5 h-3.5 text-primary" />
  }

  if (stage === "expandContext") {
    return <Search className="w-3.5 h-3.5 text-cyan-500" />
  }

  if (stage === "aggregation") {
    return <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
  }

  return <Circle className="w-3.5 h-3.5 text-muted-foreground" />
}

export function ChatStatus({
  status,
  stages,
  stageLogs,
  defaultCollapsed = false,
  isRunning = true,
}: ChatStatusProps) {
  const t = useTranslations("chat")
  const locale = useLocale()
  const [isTimelineOpen, setIsTimelineOpen] = useState(!defaultCollapsed)
  const timelineRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const stageDefinitions: Array<{ key: keyof AgentStageProgress; label: string }> = [
    { key: "rewrite", label: t("stages.rewrite") },
    { key: "toolCall", label: t("stages.toolCall") },
    { key: "expandContext", label: t("stages.expandContext") },
    { key: "aggregation", label: t("stages.aggregation") },
  ]

  const stageLabel = (stage: AgentStageLogStage): string => {
    if (stage === "rewrite") return t("stages.rewrite")
    if (stage === "toolCall") return t("stages.toolCall")
    if (stage === "expandContext") return t("stages.expandContext")
    if (stage === "aggregation") return t("stages.aggregation")
    return t("agent.system")
  }

  const formatTimelineTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }

  useEffect(() => {
    setIsTimelineOpen(!defaultCollapsed)
  }, [defaultCollapsed])

  useEffect(() => {
    if (isTimelineOpen) {
      shouldStickToBottomRef.current = true
    }
  }, [isTimelineOpen])

  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline || !isTimelineOpen || !shouldStickToBottomRef.current) {
      return
    }

    timeline.scrollTop = timeline.scrollHeight
  }, [stageLogs.length, isTimelineOpen])

  const handleTimelineScroll = () => {
    const timeline = timelineRef.current
    if (!timeline) return

    const distanceToBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight
    shouldStickToBottomRef.current = distanceToBottom <= 24
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span
          className={`inline-flex h-7 items-center gap-2 rounded-full border px-3 ${
            isRunning
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          {t("agent.label")}
        </span>
        <span>{status}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {stageDefinitions.map((stage) => {
          const stageStatus = stages[stage.key]

          const itemClass =
            stageStatus === "completed"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : stageStatus === "active"
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/70 bg-muted/60 text-muted-foreground"

          return (
            <div
              key={stage.key}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${itemClass}`}
            >
              <StageIcon status={stageStatus} />
              <span>{stage.label}</span>
            </div>
          )
        })}
      </div>

      {stageLogs.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-background/60 px-3 py-3">
          <button
            type="button"
            onClick={() => setIsTimelineOpen((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={isTimelineOpen}
          >
            <span>{t("timeline.label", { count: stageLogs.length })}</span>
            <span className="inline-flex items-center gap-1">
              {isTimelineOpen ? t("timeline.collapse") : t("timeline.expand")}
              {isTimelineOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
          </button>

          {isTimelineOpen && (
            <div
              ref={timelineRef}
              onScroll={handleTimelineScroll}
              className="max-h-[24rem] space-y-2 overflow-y-auto pr-1"
            >
              {stageLogs.map((log, index) => {
                const isLast = index === stageLogs.length - 1

                return (
                  <div key={log.id} className="relative pl-7">
                    {!isLast && (
                      <span className="absolute left-[9px] top-5 h-[calc(100%-10px)] w-px bg-border/60" />
                    )}

                    <span className="absolute left-0 top-0.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border/70 bg-card">
                      <TimelineStageIcon stage={log.stage} />
                    </span>

                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between gap-3 text-[11px] leading-none">
                        <span className="font-medium text-foreground/90">{stageLabel(log.stage)}</span>
                        <span className="text-muted-foreground">{formatTimelineTime(log.timestamp)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{log.message}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
