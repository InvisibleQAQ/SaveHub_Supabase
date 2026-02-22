export const locales = ["en", "zh"] as const
export type AppLocale = (typeof locales)[number]

export const defaultLocale: AppLocale = "en"
export const localeCookieName = "savehub_locale"
export const localeCookieMaxAge = 60 * 60 * 24 * 365

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "en" || value === "zh"
}
