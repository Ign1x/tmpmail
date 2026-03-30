import { type NextRequest, NextResponse } from "next/server"

import {
  DEFAULT_PROVIDER_BASE_URL,
  DEFAULT_PROVIDER_ID,
  PRESET_PROVIDERS,
} from "@/lib/provider-config"

export const dynamic = "force-dynamic"

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return false
  }

  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  )
}

function isDisallowedCustomBaseUrl(value: string): boolean {
  let parsed: URL

  try {
    parsed = new URL(value)
  } catch {
    return true
  }

  const hostname = parsed.hostname.toLowerCase()
  const protocolAllowed =
    parsed.protocol === "http:" || parsed.protocol === "https:"
  if (!protocolAllowed || parsed.username || parsed.password) {
    return true
  }

  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.startsWith("fe80:") ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    isPrivateIpv4(hostname)
  ) {
    return true
  }

  return false
}

function getApiBaseUrl(request: NextRequest): string {
  const providerBaseUrl = request.headers
    .get("X-API-Provider-Base-URL")
    ?.trim()
  if (providerBaseUrl) {
    if (isDisallowedCustomBaseUrl(providerBaseUrl)) {
      throw new Error("Invalid provider base URL")
    }

    return providerBaseUrl
  }

  const providerId =
    request.headers.get("X-API-Provider-ID")?.trim() || DEFAULT_PROVIDER_ID
  const provider = PRESET_PROVIDERS.find((item) => item.id === providerId)

  if (providerId === DEFAULT_PROVIDER_ID) {
    return (
      process.env.TMPMAIL_SERVER_API_BASE_URL?.trim() ||
      DEFAULT_PROVIDER_BASE_URL
    )
  }

  return provider?.baseUrl || DEFAULT_PROVIDER_BASE_URL
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization")?.trim()
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const accountId = request.nextUrl.searchParams.get("accountId")?.trim()
  if (!accountId) {
    return NextResponse.json(
      { error: "Account ID is required" },
      { status: 400 },
    )
  }

  const controller = new AbortController()
  request.signal.addEventListener("abort", () => controller.abort())

  try {
    const upstreamBaseUrl = getApiBaseUrl(request).replace(/\/+$/, "")
    const upstreamUrl = `${upstreamBaseUrl}/events?accountId=${encodeURIComponent(accountId)}`
    const forwardedProto =
      request.headers.get("X-Forwarded-Proto")?.trim() ||
      request.nextUrl.protocol.replace(":", "")
    const forwardedHost =
      request.headers.get("X-Forwarded-Host")?.trim() ||
      request.headers.get("Host")?.trim() ||
      request.nextUrl.host

    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...(forwardedProto ? { "X-Forwarded-Proto": forwardedProto } : {}),
        ...(forwardedHost ? { "X-Forwarded-Host": forwardedHost } : {}),
      },
      signal: controller.signal,
      cache: "no-store",
    })

    if (!upstream.ok || !upstream.body) {
      const message = await upstream.text().catch(() => "Upstream SSE failed")
      return new Response(message || "Upstream SSE failed", {
        status: upstream.status || 502,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      })
    }

    const headers = new Headers(upstream.headers)
    headers.set("Content-Type", "text/event-stream")
    headers.set("Cache-Control", "no-cache, no-transform")
    headers.set("Connection", "keep-alive")
    headers.delete("content-length")
    headers.delete("transfer-encoding")

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected SSE proxy error"
    return NextResponse.json(
      { error: "SSE proxy failed", details: message },
      { status: 502 },
    )
  }
}
