import type { NextRequest, NextResponse } from "next/server"

import { ADMIN_SESSION_COOKIE_KEY } from "@/lib/admin-session-cookie"

function trustProxyHeaders(): boolean {
  const value = process.env.TMPMAIL_TRUST_PROXY_HEADERS?.trim().toLowerCase()
  return ["1", "true", "yes", "on"].includes(value || "")
}

function isSecureRequest(request: NextRequest): boolean {
  if (trustProxyHeaders()) {
    const forwardedProto = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .toLowerCase()

    if (forwardedProto) {
      return forwardedProto === "https"
    }
  }

  return request.nextUrl.protocol === "https:"
}

function buildAdminSessionCookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest(request),
    path: "/",
  }
}

export function readAdminSessionCookie(request: NextRequest): string {
  return request.cookies.get(ADMIN_SESSION_COOKIE_KEY)?.value?.trim() || ""
}

export function setAdminSessionCookie(
  response: NextResponse,
  request: NextRequest,
  sessionToken: string,
): void {
  const trimmedToken = sessionToken.trim()
  if (!trimmedToken) {
    return
  }

  response.cookies.set({
    ...buildAdminSessionCookieOptions(request),
    name: ADMIN_SESSION_COOKIE_KEY,
    value: trimmedToken,
  })
}

export function clearAdminSessionCookie(response: NextResponse, request: NextRequest): void {
  response.cookies.set({
    ...buildAdminSessionCookieOptions(request),
    name: ADMIN_SESSION_COOKIE_KEY,
    value: "",
    maxAge: 0,
  })
}
