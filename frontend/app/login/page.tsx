"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useAuth } from "@/lib/context/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"

type AuthMode = "login" | "register"

export default function LoginPage() {
  const t = useTranslations("common")
  const { login, register } = useAuth()
  const [mode, setMode] = useState<AuthMode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      if (mode === "login") {
        await login(email, password)
      } else {
        await register(email, password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errors.authenticationFailed"))
    } finally {
      setIsLoading(false)
    }
  }

  const toggleMode = () => {
    setMode(mode === "login" ? "register" : "login")
    setError(null)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">{t("app.name")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "login" ? t("auth.subtitleSignIn") : t("auth.subtitleRegister")}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.fields.email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t("auth.fields.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.fields.password")}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t("auth.fields.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                minLength={6}
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === "login" ? t("auth.actions.signingIn") : t("auth.actions.creatingAccount")}
                </>
              ) : (
                mode === "login" ? t("auth.actions.signIn") : t("auth.actions.createAccount")
              )}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm">
            <span className="text-muted-foreground">
              {mode === "login" ? t("auth.prompts.noAccount") : t("auth.prompts.hasAccount")}
            </span>{" "}
            <button
              type="button"
              onClick={toggleMode}
              className="text-primary hover:underline"
              disabled={isLoading}
            >
              {mode === "login" ? t("auth.actions.signUp") : t("auth.actions.signInLower")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
