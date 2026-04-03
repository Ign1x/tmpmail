import createMiddleware from "next-intl/middleware"
import { NextRequest, NextResponse } from "next/server"

import {
  getAdminConsoleEntryPath,
  getAdminEntryPath,
  getLocalizedHomePath,
} from "./lib/admin-entry"
import { routing } from "./i18n/routing"

const handleI18nRouting = createMiddleware(routing)
const adminEntryPath = getAdminEntryPath()
const adminConsoleEntryPath = getAdminConsoleEntryPath()

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1)
  }

  return pathname
}

function resolvePreferredLocale(request: NextRequest, pathname: string): string {
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value
  if (cookieLocale && routing.locales.includes(cookieLocale as (typeof routing.locales)[number])) {
    return cookieLocale
  }

  const matchedLocale = routing.locales.find(
    (locale) => pathname === `/${locale}/admin` || pathname === `/${locale}/admin/console`,
  )
  return matchedLocale ?? routing.defaultLocale
}

function redirectToPath(request: NextRequest, locale: string, targetPath: string) {
  const url = request.nextUrl.clone()
  url.pathname = targetPath

  const response = NextResponse.redirect(url)
  response.cookies.set("NEXT_LOCALE", locale, {
    path: "/",
    sameSite: "lax",
  })

  return response
}

export default function proxy(request: NextRequest) {
  const pathname = normalizePathname(request.nextUrl.pathname)
  const localizedAdminLocale = routing.locales.find((locale) => pathname === `/${locale}/admin`)
  const localizedAdminConsoleLocale = routing.locales.find(
    (locale) => pathname === `/${locale}/admin/console`,
  )
  const locale =
    localizedAdminLocale ??
    localizedAdminConsoleLocale ??
    resolvePreferredLocale(request, pathname)

  if (
    pathname === "/admin" ||
    pathname === "/admin/console" ||
    pathname === adminEntryPath ||
    pathname === adminConsoleEntryPath ||
    Boolean(localizedAdminLocale) ||
    Boolean(localizedAdminConsoleLocale)
  ) {
    return redirectToPath(request, locale, getLocalizedHomePath(locale))
  }

  return handleI18nRouting(request)
}

export const config = {
  // Match all page routes except API routes, internal Next.js assets, and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
}
