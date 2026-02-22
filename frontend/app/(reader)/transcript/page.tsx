"use client"

import { useState, useRef, useEffect } from "react"
import { useToast } from "@/hooks/use-toast"
import { TranscriptForm } from "@/components/transcript/transcript-form"
import { ProgressDisplay } from "@/components/transcript/progress-display"
import { TranscriptResult } from "@/components/transcript/transcript-result"
import { transcriptApi, TranscriptResultData } from "@/lib/api/transcript"
import { useTranslations } from "next-intl"

type ProcessingStatus = "idle" | "starting" | "processing" | "completed" | "error"

export default function TranscriptPage() {
  const t = useTranslations("transcript")
  const { toast } = useToast()
  
  // State Machine
  const [status, setStatus] = useState<ProcessingStatus>("idle")
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState("")
  const [result, setResult] = useState<TranscriptResultData | null>(null)
  const [videoTitle, setVideoTitle] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  
  const abortControllerRef = useRef<AbortController | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const handleStart = async ({ url, language }: { url: string; language: string }) => {
    try {
      setStatus("starting")
      setProgress(0)
      setStage(t("progress.stageInitializing"))
      setResult(null)
      setErrorMessage(null)

      // 1. Start Task
      const task = await transcriptApi.startTask(url, language)
      
      setStatus("processing")
      setStage(t("progress.stageStarted"))

      // 2. Stream Task
      abortControllerRef.current = new AbortController()
      
      await transcriptApi.streamTask(
        task.task_id,
        (event) => {
          const { event: type, data } = event

          // Update video title if available
          if (data.result?.video_title) {
            setVideoTitle(data.result.video_title)
          }

          switch (type) {
            case "accepted":
              setStage(t("progress.stageAccepted"))
              break
            
            case "progress":
              if (typeof data.progress === "number") {
                setProgress(data.progress)
              }
              if (data.stage) {
                setStage(data.stage)
              }
              break
            
            case "result":
            case "done":
              if (data.result) {
                setResult(data.result)
                setStatus("completed")
                setProgress(100)
                setStage(t("progress.stageCompleted"))
                toast({
                  title: t("toast.successTitle"),
                  description: t("toast.successDescription"),
                })
              }
              break
            
            case "error":
              console.error("Task Error:", data)
              setStatus("error")
              setErrorMessage(data.message || t("errors.unknownError"))
              toast({
                title: t("toast.errorTitle"),
                description: data.message || t("toast.taskFailed"),
                variant: "destructive",
              })
              break
              
            case "heartbeat":
              // Optional: Update last active timestamp
              break
          }
        },
        abortControllerRef.current.signal
      )

    } catch (error: any) {
      if (error.name === "AbortError") return

      console.error("Transcription failed:", error)
      setStatus("error")
      setErrorMessage(error.message || t("errors.connectFailed"))
      toast({
        title: t("toast.connectionErrorTitle"),
        description: error.message,
        variant: "destructive",
      })
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="container py-8 mx-auto space-y-8 animate-in fade-in duration-500">
        <div className="space-y-2 text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t("page.title")}</h1>
          <p className="text-muted-foreground">
            {t("page.subtitle")}
          </p>
        </div>

        <TranscriptForm
          isLoading={status === "starting" || status === "processing"}
          onSubmit={handleStart}
        />

        <ProgressDisplay
          status={status}
          progress={progress}
          stage={stage}
        />

        {status === "error" && errorMessage && (
          <div className="w-full max-w-4xl mx-auto p-4 border border-destructive/50 rounded-lg bg-destructive/10 text-destructive text-center">
            <p className="font-medium">{t("errors.errorWithMessage", { message: errorMessage })}</p>
            <p className="text-sm opacity-80 mt-1">{t("errors.checkUrlAndRetry")}</p>
          </div>
        )}

        {status === "completed" && result && (
          <TranscriptResult data={result} videoTitle={videoTitle} />
        )}
      </div>
    </div>
  )
}
