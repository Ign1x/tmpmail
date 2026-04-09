import { type NextRequest, NextResponse } from "next/server";

import { ADMIN_SESSION_PROXY_HEADER } from "@/lib/admin-session-cookie";
import {
  clearAdminSessionCookie,
  readAdminSessionCookie,
  setAdminSessionCookie,
} from "@/lib/admin-session-server";
import { DEFAULT_PROVIDER_BASE_URL } from "@/lib/provider-config";

const UPSTREAM_TIMEOUT_MS = 15_000;
const BODY_LIMIT_BYTES = 1024 * 1024;
const ADMIN_SESSION_ESTABLISH_ENDPOINTS = new Set([
  "POST /admin/setup",
  "POST /admin/login",
  "POST /admin/register",
  "POST /admin/linux-do/complete",
  "POST /admin/recover",
]);
const ADMIN_SESSION_CLEAR_ENDPOINTS = new Set(["POST /admin/password"]);

function getApiBaseUrl(): string {
  return process.env.TMPMAIL_SERVER_API_BASE_URL?.trim() || DEFAULT_PROVIDER_BASE_URL;
}

function trustProxyHeaders(): boolean {
  const value = process.env.TMPMAIL_TRUST_PROXY_HEADERS?.trim().toLowerCase()
  return ["1", "true", "yes", "on"].includes(value || "")
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

  headers.delete(ADMIN_SESSION_PROXY_HEADER);

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

    const requestKey = createRequestKey(options.method, endpoint);
    if (
      response.ok &&
      ADMIN_SESSION_ESTABLISH_ENDPOINTS.has(requestKey) &&
      isJsonLikeResponse(response)
    ) {
      return await buildAdminSessionResponse(originalRequest, response);
    }

    return buildProxyResponse(originalRequest, endpoint, response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(
        `[mail-proxy] Request timed out endpoint=${endpoint} upstream=${getApiBaseUrl().replace(/\/+$/, "")}${endpoint} timeoutMs=${UPSTREAM_TIMEOUT_MS}`,
      );
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

function createRequestKey(method: string | undefined, endpoint: string): string {
  return `${(method || "GET").toUpperCase()} ${endpoint}`;
}

function isAdminSessionProxyRequest(request: NextRequest): boolean {
  const headerValue = request.headers
    .get(ADMIN_SESSION_PROXY_HEADER)
    ?.trim()
    .toLowerCase()

  return ["1", "true", "yes", "on"].includes(headerValue || "")
}

function isJsonLikeResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() || ""
  return (
    contentType.includes("application/json") ||
    contentType.includes("application/ld+json")
  )
}

function buildProxyResponse(
  originalRequest: NextRequest,
  endpoint: string,
  response: Response,
): Response {
  const proxiedResponse = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: buildResponseHeaders(response),
  });

  if (
    (isAdminSessionProxyRequest(originalRequest) &&
      (response.status === 401 || response.status === 403)) ||
    (response.ok &&
      ADMIN_SESSION_CLEAR_ENDPOINTS.has(
        createRequestKey(originalRequest.method, endpoint),
      ))
  ) {
    clearAdminSessionCookie(proxiedResponse, originalRequest);
  }

  return proxiedResponse;
}

async function buildAdminSessionResponse(
  originalRequest: NextRequest,
  response: Response,
): Promise<Response> {
  const payload = await response
    .clone()
    .json()
    .catch(() => null);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return buildProxyResponse(originalRequest, "", response);
  }

  const sessionToken =
    typeof (payload as { sessionToken?: unknown }).sessionToken === "string"
      ? (payload as { sessionToken: string }).sessionToken.trim()
      : "";
  if (!sessionToken) {
    return buildProxyResponse(originalRequest, "", response);
  }

  const redactedPayload = { ...(payload as Record<string, unknown>) };
  delete redactedPayload.sessionToken;

  const proxiedResponse = NextResponse.json(redactedPayload, {
    status: response.status,
    statusText: response.statusText,
  });

  for (const [name, value] of buildResponseHeaders(response).entries()) {
    if (name.toLowerCase() === "content-type") {
      continue;
    }

    proxiedResponse.headers.set(name, value);
  }

  setAdminSessionCookie(proxiedResponse, originalRequest, sessionToken);

  return proxiedResponse;
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
  const declaredLength = Number.parseInt(
    request.headers.get("content-length")?.trim() || "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > BODY_LIMIT_BYTES) {
    return NextResponse.json(
      { error: "Request body is too large" },
      { status: 413 },
    );
  }

  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (Buffer.byteLength(rawBody, "utf8") > BODY_LIMIT_BYTES) {
    return NextResponse.json(
      { error: "Request body is too large" },
      { status: 413 },
    );
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
  const sessionToken =
    !authHeader && isAdminSessionProxyRequest(request)
      ? readAdminSessionCookie(request)
      : "";
  const headers: Record<string, string> = {};

  if (authHeader) {
    headers.Authorization = authHeader;
  } else if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  if (trustProxyHeaders()) {
    const forwardedProto = resolveForwardedProto(request)
    const forwardedHost = resolveForwardedHost(request)
    if (forwardedProto) {
      headers["X-Forwarded-Proto"] = forwardedProto;
    }
    if (forwardedHost) {
      headers["X-Forwarded-Host"] = forwardedHost;
    }
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
