# i18n Code Review Report

Date: 2026-02-22 | Scope: 56 files, +2513/-570 lines | Library: next-intl 4.8.3

## Critical (must fix before merge)

### 1. Missing `readerLayout` keys in zh/common.json — runtime crash

- File: `app/(reader)/layout.tsx:68,84,99,112,121`
- Uses `t("readerLayout.authenticating")`, `t("readerLayout.checkingDatabaseStatus")`, etc.
- `messages/en/common.json` has these keys, but `messages/zh/common.json` does NOT
- Impact: Chinese locale users entering any reader route get missing key error

Fix: Add to `messages/zh/common.json`:
```json
"readerLayout": {
  "authenticating": "正在验证身份...",
  "checkingDatabaseStatus": "正在检查数据库状态...",
  "loadingRssReader": "正在加载 RSS 阅读器...",
  "errorLoadingData": "数据加载失败",
  "tryAgain": "重试"
}
```

### 2. Missing `settings` namespace — entire settings module unlocalized

- `messages/en/settings.json` and `messages/zh/settings.json` do not exist
- `messages/en/index.ts` and `messages/zh/index.ts` do not import settings
- Impact: Settings pages cannot be i18n-ified; `types/next-intl.d.ts` type inference incomplete

Fix: Create settings.json (content already extracted by Codex in previous session), update index.ts to import it.

## Major (should fix before merge)

### 3. `t` function in useEffect dependency array causes unnecessary data reload

- File: `app/(reader)/layout.tsx:60`
- `useEffect(..., [isDatabaseReady, loadFromSupabase, setError, t])`
- `t` reference changes on locale switch → triggers `loadFromSupabase()` re-execution
- Fix: Extract error message outside effect, remove `t` from deps

### 4. Dynamic import path prevents static analysis

- File: `i18n/request.ts:27`
- `await import(\`@/messages/${locale}/index\`)` — Webpack/Turbopack cannot statically analyze
- Fix: Use explicit loader map:
```ts
const loaders: Record<AppLocale, () => Promise<{default: typeof import("@/messages/en")}>> = {
  en: () => import("@/messages/en"),
  zh: () => import("@/messages/zh"),
}
```

### 5. `index.ts` aggregation files are untracked by git

- `messages/en/index.ts` and `messages/zh/index.ts` show as `??` in git status
- These are runtime dependencies of `i18n/request.ts` — deployment will fail without them
- Fix: `git add frontend/messages/en/index.ts frontend/messages/zh/index.ts`

## Minor

### 6. `reader.repositories` namespace has only one key

- `article-repositories.tsx:16` uses `useTranslations("reader.repositories")`
- `reader.json` → `repositories` node has only `relatedGithubRepositories`
- Consider merging into `reader.articleContent` to reduce namespace fragmentation

### 7. No ICU plural syntax for English

- e.g. `sidebar.json` → `feedsCount: "Feeds ({count})"` — should be "Feed" when count=1
- Low impact; Chinese has no plural forms

### 8. `metadata.title` in root layout not localized

- `app/layout.tsx:14-18` — hardcoded English metadata
- Next.js `generateMetadata` supports i18n but requires extra config

## Passed

- en/zh JSON key structures fully aligned (all 6 existing namespaces)
- Cookie security: Secure flag conditional, SameSite=Lax, value constrained by AppLocale type
- Accept-Language detection: correct priority (zh/zh-* → "zh", en/en-* → "en")
- NextIntlClientProvider placement: correct (wraps ThemeProvider + AuthProvider)
- `useLocale()` for date formatting in chat-status.tsx: correct pattern
