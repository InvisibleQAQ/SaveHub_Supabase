"use client"

import { useState } from "react"
import { Send, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useTranslations } from "next-intl"

interface TranscriptFormProps {
  isLoading: boolean
  onSubmit: (data: { url: string; language: string }) => void
}

export function TranscriptForm({ isLoading, onSubmit }: TranscriptFormProps) {
  const t = useTranslations("transcript")
  const [url, setUrl] = useState("")
  const [language, setLanguage] = useState("zh")
  const languages = [
    { value: "zh", label: t("form.languages.zh") },
    { value: "en", label: t("form.languages.en") },
    { value: "ja", label: t("form.languages.ja") },
    { value: "ko", label: t("form.languages.ko") },
    { value: "es", label: t("form.languages.es") },
    { value: "fr", label: t("form.languages.fr") },
    { value: "de", label: t("form.languages.de") },
  ]

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (url.trim()) {
      onSubmit({ url: url.trim(), language })
    }
  }

  return (
    <Card className="w-full max-w-4xl mx-auto shadow-sm">
      <CardHeader>
        <CardTitle>{t("form.title")}</CardTitle>
        <CardDescription>
          {t("form.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Input
              placeholder={t("form.urlPlaceholder")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isLoading}
              className="pr-10"
              required
            />
          </div>
          
          <div className="w-full md:w-48">
            <Select 
              value={language} 
              onValueChange={setLanguage} 
              disabled={isLoading}
            >
              <SelectTrigger>
                <Globe className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder={t("form.targetLanguagePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" disabled={isLoading || !url.trim()}>
            {isLoading ? t("form.submitProcessing") : t("form.submitStart")}
            {!isLoading && <Send className="w-4 h-4 ml-2" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
