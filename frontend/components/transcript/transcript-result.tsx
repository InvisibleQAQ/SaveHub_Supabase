"use client"

import { useState } from "react"
import { marked } from "marked"
import DOMPurify from "dompurify"
import { Download, Copy, Check, FileText, AlignLeft, Languages } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { TranscriptResultData } from "@/lib/api/transcript"
import { useTranslations } from "next-intl"

interface TranscriptResultProps {
  data: TranscriptResultData
  videoTitle?: string
}

export function TranscriptResult({ data, videoTitle }: TranscriptResultProps) {
  const t = useTranslations("transcript")
  const { toast } = useToast()
  const [copiedSection, setCopiedSection] = useState<string | null>(null)
  const transcriptLabel = t("result.tabs.transcript")
  const summaryLabel = t("result.tabs.summary")
  const translationLabel = t("result.tabs.translation")

  const renderMarkdown = (content: string) => {
    if (!content) return { __html: "" }
    const rawHtml = marked.parse(content) as string
    return { __html: DOMPurify.sanitize(rawHtml) }
  }

  const handleCopy = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSection(section)
      toast({
        title: t("toast.copiedTitle"),
        description: t("toast.copiedDescription", { section }),
      })
      setTimeout(() => setCopiedSection(null), 2000)
    } catch (err) {
      toast({
        title: t("toast.copyFailedTitle"),
        description: t("toast.copyFailedDescription"),
        variant: "destructive",
      })
    }
  }

  const handleDownload = () => {
    const content = `# ${videoTitle || t("result.markdownTitleFallback")}

` +
      `## ${summaryLabel}

${data.summary}

` +
      `## ${transcriptLabel}

${data.transcript_optimized || data.transcript_raw}

` +
      `## ${translationLabel}

${data.translation}`

    const blob = new Blob([content], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `transcript-${new Date().toISOString().slice(0, 10)}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    toast({
      title: t("toast.downloadedTitle"),
      description: t("toast.downloadedDescription"),
    })
  }

  return (
    <div className="w-full max-w-4xl mx-auto mt-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold truncate max-w-[70%]">
          {videoTitle || t("result.titleFallback")}
        </h2>
        <Button variant="outline" size="sm" onClick={handleDownload} className="gap-2">
          <Download className="w-4 h-4" />
          {t("result.downloadMd")}
        </Button>
      </div>

      <Tabs defaultValue="transcript" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="transcript" className="gap-2">
            <AlignLeft className="w-4 h-4" /> {transcriptLabel}
          </TabsTrigger>
          <TabsTrigger value="summary" className="gap-2">
            <FileText className="w-4 h-4" /> {summaryLabel}
          </TabsTrigger>
          <TabsTrigger value="translation" className="gap-2">
            <Languages className="w-4 h-4" /> {translationLabel}
          </TabsTrigger>
        </TabsList>

        {/* Content Renderer Helper */}
        {([
          { key: "transcript", content: data.transcript_optimized || data.transcript_raw, label: transcriptLabel },
          { key: "summary", content: data.summary, label: summaryLabel },
          { key: "translation", content: data.translation, label: translationLabel },
        ] as const).map(({ key, content, label }) => (
          <TabsContent key={key} value={key}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("result.contentTitle", { label })}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(content, label)}
                  className="h-8 w-8 p-0"
                >
                  {copiedSection === label ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  <span className="sr-only">{t("result.copySrOnly", { label })}</span>
                </Button>
              </CardHeader>
              <CardContent>
                <div 
                  className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:p-4 rounded-md overflow-x-auto"
                  dangerouslySetInnerHTML={renderMarkdown(content || t("result.noContent"))}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
