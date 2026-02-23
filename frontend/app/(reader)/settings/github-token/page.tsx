"use client"

import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useRSSStore } from "@/lib/store"
import { githubApi } from "@/lib/api/github"
import { useToast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Loader2, Key, ExternalLink } from "lucide-react"
import { useTranslations } from "next-intl"

export default function GitHubTokenPage() {
  const { settings, updateSettings } = useRSSStore()
  const { toast } = useToast()
  const t = useTranslations("settings.githubToken")
  const [token, setToken] = useState("")
  const [isValidating, setIsValidating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    username?: string
    error?: string
  } | null>(null)

  const hasToken = !!settings.githubToken

  const handleValidate = async () => {
    if (!token.trim()) {
      toast({
        title: t("toasts.validationFailed"),
        description: t("toasts.tokenEmpty"),
        variant: "destructive",
      })
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const result = await githubApi.validateGitHubToken(token)
      setValidationResult(result)

      if (result.valid) {
        toast({
          title: t("toasts.validationSuccess"),
          description: t("toasts.tokenValid", { username: result.username ?? "" }),
        })
      } else {
        toast({
          title: t("toasts.validationFailed"),
          description: result.error,
          variant: "destructive",
        })
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : t("toasts.validationError")
      setValidationResult({ valid: false, error: errorMsg })
      toast({
        title: t("toasts.validationFailed"),
        description: errorMsg,
        variant: "destructive",
      })
    } finally {
      setIsValidating(false)
    }
  }

  const handleSave = async () => {
    if (!validationResult?.valid) return

    setIsSaving(true)
    try {
      await updateSettings({ githubToken: token })
      setToken("")
      setValidationResult(null)
      toast({
        title: t("toasts.saveSuccess"),
        description: hasToken ? t("toasts.tokenUpdated") : t("toasts.tokenSaved"),
      })
    } catch (error) {
      toast({
        title: t("toasts.saveFailed"),
        description: error instanceof Error ? error.message : t("toasts.saveRetry"),
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemove = async () => {
    setIsSaving(true)
    try {
      await updateSettings({ githubToken: null as any })
      toast({
        title: t("toasts.deleteSuccess"),
        description: t("toasts.tokenDeleted"),
      })
    } catch (error) {
      toast({
        title: t("toasts.deleteFailed"),
        description: error instanceof Error ? error.message : t("toasts.deleteRetry"),
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
      setShowDeleteDialog(false)
    }
  }

  const maskToken = (tk?: string) => {
    if (!tk) return t("status.notSet")
    if (tk.length <= 8) return "****"
    return `${tk.slice(0, 4)}****${tk.slice(-4)}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-2">{t("description")}</p>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {t("status.cardTitle")}
          </CardTitle>
          <CardDescription>
            {hasToken ? t("status.configured") : t("status.notConfigured")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("status.tokenValue")}</Label>
            <div className="flex items-center gap-2">
              <Input value={maskToken(settings.githubToken)} disabled className="flex-1 font-mono" />
              {hasToken && (
                <Button variant="destructive" onClick={() => setShowDeleteDialog(true)} disabled={isSaving} size="sm">
                  {t("status.delete")}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("status.encryptedHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{hasToken ? t("form.updateTitle") : t("form.addTitle")}</CardTitle>
          <CardDescription>
            {hasToken ? t("form.updateDescription") : t("form.addDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Label htmlFor="github-token">{t("form.label")}</Label>
            <Input
              id="github-token"
              type="password"
              placeholder={t("form.placeholder")}
              value={token}
              onChange={(e) => { setToken(e.target.value); setValidationResult(null) }}
              className="font-mono"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleValidate} disabled={!token.trim() || isValidating} variant="outline">
              {isValidating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("form.validating")}</>
              ) : t("form.validateToken")}
            </Button>
            <Button onClick={handleSave} disabled={!validationResult?.valid || isSaving}>
              {isSaving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("form.saving")}</>
              ) : hasToken ? t("form.updateToken") : t("form.saveToken")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="text-base">{t("instructions.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">1.</span>
              <span>{t("instructions.step1")}</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">2.</span>
              <span>{t("instructions.step2")}</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">3.</span>
              <span>{t("instructions.step3Prefix")}<code className="px-1 py-0.5 bg-muted rounded text-xs">repo</code>{t("instructions.step3Conjunction")}<code className="px-1 py-0.5 bg-muted rounded text-xs">user</code></span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">4.</span>
              <span>{t("instructions.step4")}</span>
            </li>
          </ol>
          <div className="pt-2">
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t("instructions.createOnGitHub")}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isSaving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("deleteDialog.deleting")}</>
              ) : t("deleteDialog.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
