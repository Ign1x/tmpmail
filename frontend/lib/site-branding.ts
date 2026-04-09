import type { SiteBrandingSettings } from "@/lib/api"
import { BRAND_NAME, DEFAULT_BRAND_LOGO_URL } from "@/lib/provider-config"

export interface ResolvedSiteBranding {
  brandName: string
  brandLogoUrl: string
}

export const DEFAULT_SITE_BRANDING: ResolvedSiteBranding = {
  brandName: BRAND_NAME,
  brandLogoUrl: DEFAULT_BRAND_LOGO_URL,
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function normalizeBrandLogoUrl(value: string | undefined): string | undefined {
  const normalized = normalizeText(value)
  if (!normalized) {
    return undefined
  }

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("data:image/") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  ) {
    return normalized
  }

  return undefined
}

export function resolveSiteBranding(
  branding?: SiteBrandingSettings | null,
): ResolvedSiteBranding {
  return {
    brandName: normalizeText(branding?.name) ?? DEFAULT_SITE_BRANDING.brandName,
    brandLogoUrl:
      normalizeBrandLogoUrl(branding?.logoUrl) ?? DEFAULT_SITE_BRANDING.brandLogoUrl,
  }
}

export function replaceBrandNameText(text: string, brandName: string): string {
  return text.replaceAll("TmpMail", brandName)
}
