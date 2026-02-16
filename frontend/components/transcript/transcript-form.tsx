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

interface TranscriptFormProps {
  isLoading: boolean
  onSubmit: (data: { url: string; language: string }) => void
}

const LANGUAGES = [
  { value: "zh", label: "Chinese (Simplified)" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
]

export function TranscriptForm({ isLoading, onSubmit }: TranscriptFormProps) {
  const [url, setUrl] = useState("")
  const [language, setLanguage] = useState("zh")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (url.trim()) {
      onSubmit({ url: url.trim(), language })
    }
  }

  return (
    <Card className="w-full max-w-4xl mx-auto shadow-sm">
      <CardHeader>
        <CardTitle>Video Transcript</CardTitle>
        <CardDescription>
          Generate transcript, summary, and translation from video URL.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Input
              placeholder="Enter video URL (e.g., YouTube, Bilibili)"
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
                <SelectValue placeholder="Target Language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" disabled={isLoading || !url.trim()}>
            {isLoading ? "Processing..." : "Start"}
            {!isLoading && <Send className="w-4 h-4 ml-2" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
