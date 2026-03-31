import { type NextRequest, NextResponse } from "next/server";

import { DEFAULT_PROVIDER_BASE_URL } from "@/lib/provider-config";

const UPSTREAM_TIMEOUT_MS = 15_000;

function getApiBaseUrl(): string {
  return process.env.TMPMAIL_SERVER_API_BASE_URL?.trim() || DEFAULT_PROVIDER_BASE_URL;
}

function normalizeEndpoint(endpoint: string | null): string | null {
  const value = endpoint?.trim();

  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("://")
  ) {
    return null;
  }

  if (/\s/.test(value)) {
    return null;
  }

  return value;
}

function buildForwardHeaders(headersInit?: HeadersInit): Headers {
  const headers = new Headers(headersInit);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/ld+json, application/json, */*");
  }

  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", "TmpMail/1.0 (Next Proxy)");
  }

  return headers;
}

function buildResponseHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.delete("connection");
  headers.set("Cache-Control", "no-store, private");
  headers.set("Pragma", "no-cache");
  return headers;
}

function logUpstreamFailure(endpoint: string, response: Response): void {
  const contentType = response.headers.get("content-type") || "unknown";

  console.error(
    `[mail-proxy] Upstream request failed endpoint=${endpoint} status=${response.status} contentType=${contentType}`,
  );
}

async function proxyRequest(
  originalRequest: NextRequest,
  endpoint: string,
  options: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const headers = buildForwardHeaders(options.headers);
    if (!options.body) {
      headers.delete("Content-Type");
    }

    const upstreamUrl = `${getApiBaseUrl().replace(/\/+$/, "")}${endpoint}`;
    const response = await fetch(upstreamUrl, {
      ...options,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status >= 500) {
      logUpstreamFailure(endpoint, response);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: buildResponseHeaders(response),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: `Failed to fetch from API: Request to ${endpoint} timed out` },
        { status: 504 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Unknown proxy error";
    console.error(
      `[mail-proxy] Request failed endpoint=${endpoint} message=${message}`,
    );
    return NextResponse.json(
      { error: `Failed to fetch from API for ${endpoint}`, details: message },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function getEndpointOrResponse(request: NextRequest): string | Response {
  const endpoint = normalizeEndpoint(
    new URL(request.url).searchParams.get("endpoint"),
  );
  if (!endpoint) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  return endpoint;
}

async function readJsonBody(request: NextRequest): Promise<string | Response> {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return JSON.stringify(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

function createAuthHeaders(
  request: NextRequest,
  contentType?: string,
): HeadersInit {
  const authHeader = request.headers.get("Authorization");
  const forwardedProto =
    request.headers.get("X-Forwarded-Proto")?.trim() ||
    request.nextUrl.protocol.replace(":", "");
  const forwardedHost =
    request.headers.get("X-Forwarded-Host")?.trim() ||
    request.headers.get("Host")?.trim() ||
    request.nextUrl.host;
  const headers: Record<string, string> = {};

  if (authHeader) {
    headers.Authorization = authHeader;
  }

  if (forwardedProto) {
    headers["X-Forwarded-Proto"] = forwardedProto;
  }

  if (forwardedHost) {
    headers["X-Forwarded-Host"] = forwardedHost;
  }

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  return headers;
}

export async function GET(request: NextRequest): Promise<Response> {
  const endpoint = getEndpointOrResponse(request);
  if (endpoint instanceof Response) {
    return endpoint;
  }

  return proxyRequest(request, endpoint, {
    method: "GET",
    headers: createAuthHeaders(request),
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const endpoint = getEndpointOrResponse(request);
  if (endpoint instanceof Response) {
    return endpoint;
  }

  const body = await readJsonBody(request);
  if (body instanceof Response) {
    return body;
  }

  return proxyRequest(request, endpoint, {
    method: "POST",
    headers: createAuthHeaders(request, "application/json"),
    body,
  });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const endpoint = getEndpointOrResponse(request);
  if (endpoint instanceof Response) {
    return endpoint;
  }

  const body = await readJsonBody(request);
  if (body instanceof Response) {
    return body;
  }

  return proxyRequest(request, endpoint, {
    method: "PATCH",
    headers: createAuthHeaders(request, "application/merge-patch+json"),
    body,
  });
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const endpoint = getEndpointOrResponse(request);
  if (endpoint instanceof Response) {
    return endpoint;
  }

  return proxyRequest(request, endpoint, {
    method: "DELETE",
    headers: createAuthHeaders(request),
  });
}
