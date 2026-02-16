"use client"

import { useState, useRef, useEffect } from "react"
import { useToast } from "@/hooks/use-toast"
import { TranscriptForm } from "@/components/transcript/transcript-form"
import { ProgressDisplay } from "@/components/transcript/progress-display"
import { TranscriptResult } from "@/components/transcript/transcript-result"
import { transcriptApi, TranscriptEventData, TranscriptResultData } from "@/lib/api/transcript"

type ProcessingStatus = "idle" | "starting" | "processing" | "completed" | "error"

export default function TranscriptPage() {
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
      setStage("Initializing task...")
      setResult(null)
      setErrorMessage(null)

      // 1. Start Task
      const task = await transcriptApi.startTask(url, language)
      
      setStatus("processing")
      setStage("Task started, waiting for stream...")

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
              setStage("Task accepted by server...")
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
                setStage("Completed")
                toast({
                  title: "Success",
                  description: "Transcription completed successfully.",
                })
              }
              break
            
            case "error":
              console.error("Task Error:", data)
              setStatus("error")
              setErrorMessage(data.message || "An unknown error occurred")
              toast({
                title: "Error",
                description: data.message || "Task failed",
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
      setErrorMessage(error.message || "Failed to connect to transcription service")
      toast({
        title: "Connection Error",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  return (
    <div className="container py-8 mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="space-y-2 text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight">AI Video Transcript</h1>
        <p className="text-muted-foreground">
          Turn video content into structured notes with AI-powered transcription and summarization.
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
          <p className="font-medium">Error: {errorMessage}</p>
          <p className="text-sm opacity-80 mt-1">Please check the URL and try again.</p>
        </div>
      )}

      {status === "completed" && result && (
        <TranscriptResult data={result} videoTitle={videoTitle} />
      )}
    </div>
  )
}
