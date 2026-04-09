import { type NextRequest, NextResponse } from "next/server"

import { DEFAULT_PROVIDER_BASE_URL } from "@/lib/provider-config"

export const dynamic = "force-dynamic"

function getApiBaseUrl(): string {
  return process.env.TMPMAIL_SERVER_API_BASE_URL?.trim() || DEFAULT_PROVIDER_BASE_URL
}

function trustProxyHeaders(): boolean {
  const value = process.env.TMPMAIL_TRUST_PROXY_HEADERS?.trim().toLowerCase()
  return ["1", "true", "yes", "on"].includes(value || "")
}

function resolveForwardedProto(request: NextRequest): string {
  const protocol = request.nextUrl.protocol.replace(":", "").trim().toLowerCase()
  return protocol === "https" ? "https" : "http"
}

function resolveForwardedHost(request: NextRequest): string {
  const host = request.nextUrl.host.trim()
  if (!host || /\s|,|\//.test(host)) {
    return ""
  }

  return host
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
    const upstreamBaseUrl = getApiBaseUrl().replace(/\/+$/, "")
    const upstreamUrl = `${upstreamBaseUrl}/events?accountId=${encodeURIComponent(accountId)}`
    const forwardedHost = resolveForwardedHost(request)
    const forwardedHeaders = trustProxyHeaders()
      ? {
          "X-Forwarded-Proto": resolveForwardedProto(request),
          ...(forwardedHost ? { "X-Forwarded-Host": forwardedHost } : {}),
        }
      : {}

    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...forwardedHeaders,
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
