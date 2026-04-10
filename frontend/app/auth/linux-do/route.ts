import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { routing } from "@/i18n/routing"

export const dynamic = "force-dynamic"

function normalizeLocale(value?: string): string {
  if (value && routing.locales.includes(value as (typeof routing.locales)[number])) {
    return value
  }

  return routing.defaultLocale
}

export async function GET(request: Request): Promise<Response> {
  const cookieStore = await cookies()
  const locale = normalizeLocale(cookieStore.get("NEXT_LOCALE")?.value)
  const url = new URL(request.url)
  const search = url.search || ""

  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: `/${locale}/auth/linux-do${search}`,
    },
  })
}
