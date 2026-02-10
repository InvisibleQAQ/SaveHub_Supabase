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
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>{status}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {STAGE_DEFINITIONS.map((stage) => {
          const stageStatus = stages[stage.key]
          return (
            <div
              key={stage.key}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-xs"
            >
              <StageIcon status={stageStatus} />
              <span>{stage.label}</span>
            </div>
          )
        })}
      </div>

      {stageLogs.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-1">
          {stageLogs.map((log, index) => (
            <div key={`${index}-${log}`}>• {log}</div>
          ))}
        </div>
      )}
    </div>
  )
}
