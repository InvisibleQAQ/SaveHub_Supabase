"use client"

import { useEffect, useState } from "react"
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

const STAGE_DEFINITIONS: Array<{
  key: keyof AgentStageProgress
  label: string
}> = [
  { key: "rewrite", label: "重写" },
  { key: "toolCall", label: "调用工具" },
  { key: "expandContext", label: "二次检索" },
  { key: "aggregation", label: "聚合" },
]

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

function stageLabel(stage: AgentStageLogStage): string {
  if (stage === "rewrite") return "重写"
  if (stage === "toolCall") return "调用工具"
  if (stage === "expandContext") return "二次检索"
  if (stage === "aggregation") return "聚合"
  return "系统"
}

function formatTimelineTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

export function ChatStatus({
  status,
  stages,
  stageLogs,
  defaultCollapsed = false,
  isRunning = true,
}: ChatStatusProps) {
  const [isTimelineOpen, setIsTimelineOpen] = useState(!defaultCollapsed)

  useEffect(() => {
    setIsTimelineOpen(!defaultCollapsed)
  }, [defaultCollapsed])

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
          Agent
        </span>
        <span>{status}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {STAGE_DEFINITIONS.map((stage) => {
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
            <span>流程日志（{stageLogs.length}）</span>
            <span className="inline-flex items-center gap-1">
              {isTimelineOpen ? "收起" : "展开"}
              {isTimelineOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
          </button>

          {isTimelineOpen &&
            stageLogs.map((log, index) => {
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
  )
}
