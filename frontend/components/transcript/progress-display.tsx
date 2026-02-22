"use client"

import { Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

interface ProgressDisplayProps {
  progress: number
  stage: string
  status: "idle" | "starting" | "processing" | "completed" | "error"
  onCancel?: () => void
}

export function ProgressDisplay({ progress, stage, status }: ProgressDisplayProps) {
  const t = useTranslations("transcript.progress")
  if (status === "idle" || status === "completed") return null

  const isError = status === "error"
  const percentage = Math.min(100, Math.max(0, progress))

  return (
    <Card className={cn("w-full max-w-4xl mx-auto mt-6 shadow-sm", isError ? "border-destructive/50" : "border-primary/20")}>
      <CardContent className="pt-6 pb-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {status === "processing" && (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              <span className={cn("font-medium", isError ? "text-destructive" : "text-foreground")}>
                {isError ? t("error") : stage || t("processing")}
              </span>
            </div>
            <span className="text-muted-foreground">{Math.round(percentage)}%</span>
          </div>

          {/* Custom Tailwind Progress Bar */}
          <div className="h-2 w-full bg-secondary overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full transition-all duration-500 ease-in-out",
                isError ? "bg-destructive" : "bg-primary"
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>
          
          <p className="text-xs text-muted-foreground text-center animate-pulse">
            {t("durationHint")}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
