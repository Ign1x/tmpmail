import { cookies, headers } from "next/headers"

import { ADMIN_SESSION_COOKIE_KEY } from "@/lib/admin-session-cookie"
import { DEFAULT_PROVIDER_BASE_URL, DEFAULT_PROVIDER_ID } from "@/lib/provider-config"

const ADMIN_SESSION_VALIDATE_TIMEOUT_MS = 5_000

function getServerAdminApiBaseUrl(): string {
  return process.env.TMPMAIL_SERVER_API_BASE_URL?.trim() || DEFAULT_PROVIDER_BASE_URL
}

export async function hasValidServerAdminSession(): Promise<boolean> {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE_KEY)?.value?.trim()

  if (!sessionToken) {
    return false
  }

  const requestHeaders = await headers()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ADMIN_SESSION_VALIDATE_TIMEOUT_MS)

  try {
    const forwardedProto =
      requestHeaders.get("x-forwarded-proto")?.trim() ||
      requestHeaders.get("x-forwarded-protocol")?.trim() ||
      "http"
    const forwardedHost =
      requestHeaders.get("x-forwarded-host")?.trim() || requestHeaders.get("host")?.trim() || ""

    const response = await fetch(`${getServerAdminApiBaseUrl().replace(/\/+$/, "")}/admin/session`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-API-Provider-ID": DEFAULT_PROVIDER_ID,
        ...(forwardedProto ? { "X-Forwarded-Proto": forwardedProto } : {}),
        ...(forwardedHost ? { "X-Forwarded-Host": forwardedHost } : {}),
      },
      cache: "no-store",
      signal: controller.signal,
    })

    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}
