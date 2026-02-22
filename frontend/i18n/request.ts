import { getRequestConfig } from "next-intl/server"
import { cookies, headers } from "next/headers"
import { defaultLocale, isAppLocale, localeCookieName, type AppLocale } from "./config"

function detectFromAcceptLanguage(value: string | null): AppLocale | null {
  if (!value) return null
  for (const part of value.split(",")) {
    const lang = part.trim().split(";")[0].toLowerCase()
    if (lang === "zh" || lang.startsWith("zh-")) return "zh"
    if (lang === "en" || lang.startsWith("en-")) return "en"
  }
  return null
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get(localeCookieName)?.value
  const headerStore = await headers()
  const acceptLang = headerStore.get("accept-language")

  const locale: AppLocale = isAppLocale(cookieLocale)
    ? cookieLocale
    : detectFromAcceptLanguage(acceptLang) ?? defaultLocale

  return {
    locale,
    messages: (await import(`@/messages/${locale}/index`)).default,
  }
})
