import "server-only"

import type { SiteBrandingSettings } from "@/lib/api"
import { DEFAULT_PROVIDER_BASE_URL } from "@/lib/provider-config"
import { DEFAULT_SITE_BRANDING, resolveSiteBranding } from "@/lib/site-branding"

function getApiBaseUrl(): string {
  return process.env.TMPMAIL_SERVER_API_BASE_URL?.trim() || DEFAULT_PROVIDER_BASE_URL
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export async function getServerSiteBranding() {
  try {
    const response = await fetch(
      `${getApiBaseUrl().replace(/\/+$/, "")}/site/branding`,
      { cache: "no-store" },
    )

    if (!response.ok) {
      return DEFAULT_SITE_BRANDING
    }

    const payload = await response.json().catch(() => null)
    if (!isRecord(payload)) {
      return DEFAULT_SITE_BRANDING
    }

    return resolveSiteBranding(payload as SiteBrandingSettings)
  } catch {
    return DEFAULT_SITE_BRANDING
  }
}
