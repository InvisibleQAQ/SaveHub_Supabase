import { localeCookieMaxAge, localeCookieName, type AppLocale } from "@/i18n/config"

export function setLocaleCookie(locale: AppLocale) {
  const secure = typeof window !== "undefined" && window.location.protocol === "https:"
  document.cookie = [
    `${localeCookieName}=${locale}`,
    "path=/",
    `max-age=${localeCookieMaxAge}`,
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ")
}
