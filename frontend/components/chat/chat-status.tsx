"use client"

import { CheckCircle2, Circle, Loader2 } from "lucide-react"

export type AgentStageStatus = "pending" | "active" | "completed"

export interface AgentStageProgress {
  rewrite: AgentStageStatus
  toolCall: AgentStageStatus
  expandContext: AgentStageStatus
  aggregation: AgentStageStatus
}

interface ChatStatusProps {
  status: string
  stages: AgentStageProgress
  stageLogs: string[]
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

export function ChatStatus({ status, stages, stageLogs }: ChatStatusProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="inline-flex h-7 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 text-primary">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
        <div className="space-y-1 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          {stageLogs.map((log, index) => (
            <div key={`${index}-${log}`}>• {log}</div>
          ))}
        </div>
      )}
    </div>
  )
}
