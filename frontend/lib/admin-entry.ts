import { routing } from "@/i18n/routing"

const DEFAULT_ADMIN_ENTRY_PATH = "/admin"

function normalizePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return DEFAULT_ADMIN_ENTRY_PATH
  }

  const withoutQuery = trimmed.split("?")[0]?.split("#")[0] ?? ""
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/")
  const normalized = collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed

  return normalized || DEFAULT_ADMIN_ENTRY_PATH
}

export function getAdminEntryPath(): string {
  const configured = normalizePath(process.env.TMPMAIL_ADMIN_ENTRY_PATH ?? DEFAULT_ADMIN_ENTRY_PATH)

  if (configured === "/") {
    return DEFAULT_ADMIN_ENTRY_PATH
  }

  if (routing.locales.some((locale) => configured === `/${locale}/admin`)) {
    return DEFAULT_ADMIN_ENTRY_PATH
  }

  return configured
}

export function getLocalizedAdminPath(locale: string): string {
  return `/${locale}/admin`
}

export function getAdminConsoleEntryPath(): string {
  return `${getAdminEntryPath()}/console`
}

export function getLocalizedAdminConsolePath(locale: string): string {
  return `/${locale}/admin/console`
}
