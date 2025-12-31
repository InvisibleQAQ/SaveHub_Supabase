"use client"

import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useRSSStore } from "@/lib/store"
import { githubApi } from "@/lib/api/github"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle2, XCircle, Loader2, Key, ExternalLink, AlertCircle } from "lucide-react"

export default function GitHubTokenPage() {
  const { settings, updateSettings } = useRSSStore()
  const [token, setToken] = useState("")
  const [isValidating, setIsValidating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    username?: string
    error?: string
  } | null>(null)
  const [saveResult, setSaveResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  const hasToken = !!settings.githubToken

  const handleValidate = async () => {
    if (!token.trim()) {
      setValidationResult({ valid: false, error: "Token 不能为空" })
      return
    }

    setIsValidating(true)
    setValidationResult(null)
    setSaveResult(null)

    try {
      const result = await githubApi.validateGitHubToken(token)
      setValidationResult(result)
    } catch (error) {
      setValidationResult({
        valid: false,
        error: error instanceof Error ? error.message : "验证失败",
      })
    } finally {
      setIsValidating(false)
    }
  }

  const handleSave = async () => {
    if (!validationResult?.valid) {
      return
    }

    setIsSaving(true)
    setSaveResult(null)

    try {
      await updateSettings({ githubToken: token })
      setToken("")
      setValidationResult(null)
      setSaveResult({
        success: true,
        message: hasToken ? "Token 已成功更新" : "Token 已成功settings.py",
      })
    } catch (error) {
      setSaveResult({
        success: false,
        message: error instanceof Error ? error.message : "保存失败，请重试",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!confirm("确定要删除 GitHub Token 吗？")) {
      return
    }

    setIsSaving(true)
    setSaveResult(null)

    try {
      // Use null to explicitly delete the token
      await updateSettings({ githubToken: null as any })
      setSaveResult({
        success: true,
        message: "Token 已成功删除",
      })
    } catch (error) {
      setSaveResult({
        success: false,
        message: error instanceof Error ? error.message : "删除失败，请重试",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const maskToken = (token?: string) => {
    if (!token) return "未设置"
    if (token.length <= 8) return "****"
    return `${token.slice(0, 4)}****${token.slice(-4)}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">GitHub Token</h1>
        <p className="text-muted-foreground mt-2">
          配置 GitHub Personal Access Token 用于 GitHub 集成功能
        </p>
      </div>

      <Separator />

      {/* Save Result Alert */}
      {saveResult && (
        <Alert variant={saveResult.success ? "default" : "destructive"}>
          <div className="flex items-center gap-2">
            {saveResult.success ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertDescription>{saveResult.message}</AlertDescription>
          </div>
        </Alert>
      )}

      {/* Current Token Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            当前 Token 状态
          </CardTitle>
          <CardDescription>
            {hasToken ? "您已配置 GitHub Token" : "尚未配置 GitHub Token"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Token 值</Label>
            <div className="flex items-center gap-2">
              <Input
                value={maskToken(settings.githubToken)}
                disabled
                className="flex-1 font-mono"
              />
              {hasToken && (
                <Button
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={isSaving}
                  size="sm"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "删除"}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Token 已加密存储，仅在设置时可见
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Add/Update Token Card */}
      <Card>
        <CardHeader>
          <CardTitle>{hasToken ? "更新" : "添加"} GitHub Token</CardTitle>
          <CardDescription>
            {hasToken ? "输入新的 Token 以替换现有配置" : "首次配置 GitHub Token"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Label htmlFor="github-token">GitHub Personal Access Token</Label>
            <Input
              id="github-token"
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                setValidationResult(null)
                setSaveResult(null)
              }}
              className="font-mono"
            />
          </div>

          {/* Validation Result */}
          {validationResult && (
            <Alert variant={validationResult.valid ? "default" : "destructive"}>
              <div className="flex items-center gap-2">
                {validationResult.valid ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <AlertDescription>
                  {validationResult.valid
                    ? `Token 有效！GitHub 用户: ${validationResult.username}`
                    : `Token 无效: ${validationResult.error}`}
                </AlertDescription>
              </div>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleValidate}
              disabled={!token.trim() || isValidating}
              variant="outline"
            >
              {isValidating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  验证中...
                </>
              ) : (
                "验证 Token"
              )}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!validationResult?.valid || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                hasToken ? "更新 Token" : "保存 Token"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Instructions Card */}
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="text-base">如何创建 GitHub Token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">1.</span>
              <span>访问 GitHub Settings → Developer settings → Personal access tokens</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">2.</span>
              <span>点击 "Generate new token (classic)"</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">3.</span>
              <span>选择权限范围：<code className="px-1 py-0.5 bg-muted rounded text-xs">repo</code> 和 <code className="px-1 py-0.5 bg-muted rounded text-xs">user</code></span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">4.</span>
              <span>复制生成的 token 并粘贴到上方输入框</span>
            </li>
          </ol>
          <div className="pt-2">
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              在 GitHub 上创建 token
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
