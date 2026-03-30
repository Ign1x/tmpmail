import { type NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_PROVIDER_BASE_URL,
  DEFAULT_PROVIDER_ID,
  PRESET_PROVIDERS,
} from "@/lib/provider-config";

const UPSTREAM_TIMEOUT_MS = 15_000;

function getServerProviderBaseUrls(): Record<string, string> {
  const providerBaseUrls = PRESET_PROVIDERS.reduce<Record<string, string>>(
    (acc, provider) => {
      acc[provider.id] = provider.baseUrl;
      return acc;
    },
    {},
  );

  providerBaseUrls[DEFAULT_PROVIDER_ID] =
    process.env.TMPMAIL_SERVER_API_BASE_URL?.trim() ||
    DEFAULT_PROVIDER_BASE_URL;

  return providerBaseUrls;
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }

  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isDisallowedCustomBaseUrl(value: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return true;
  }

  const hostname = parsed.hostname.toLowerCase();
  const protocolAllowed =
    parsed.protocol === "http:" || parsed.protocol === "https:";
  if (!protocolAllowed || parsed.username || parsed.password) {
    return true;
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
    return true;
  }

  return false;
}

function getApiBaseUrl(request: NextRequest): string | Response {
  const providerBaseUrl = request.headers
    .get("X-API-Provider-Base-URL")
    ?.trim();
  if (providerBaseUrl) {
    if (isDisallowedCustomBaseUrl(providerBaseUrl)) {
      return NextResponse.json(
        { error: "Invalid provider base URL" },
        { status: 400 },
      );
    }

    return providerBaseUrl;
  }

  const providerId =
    request.headers.get("X-API-Provider-ID")?.trim() || DEFAULT_PROVIDER_ID;
  const providerBaseUrls = getServerProviderBaseUrls();
  return providerBaseUrls[providerId] || providerBaseUrls[DEFAULT_PROVIDER_ID];
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
  const apiBaseUrl = getApiBaseUrl(originalRequest);
  if (apiBaseUrl instanceof Response) {
    return apiBaseUrl;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const headers = buildForwardHeaders(options.headers);
    if (!options.body) {
      headers.delete("Content-Type");
    }

    const upstreamUrl = `${apiBaseUrl.replace(/\/+$/, "")}${endpoint}`;
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
  const headers: Record<string, string> = {};

  if (authHeader) {
    headers.Authorization = authHeader;
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
