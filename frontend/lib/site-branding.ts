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

const SAFE_DATA_IMAGE_PREFIXES = [
  "data:image/png;",
  "data:image/png,",
  "data:image/jpeg;",
  "data:image/jpeg,",
  "data:image/jpg;",
  "data:image/jpg,",
  "data:image/gif;",
  "data:image/gif,",
  "data:image/webp;",
  "data:image/webp,",
  "data:image/avif;",
  "data:image/avif,",
] as const

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function isSafeBrandLogoDataUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return SAFE_DATA_IMAGE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export function normalizeBrandLogoUrl(value: string | undefined): string | undefined {
  const normalized = normalizeText(value)
  if (!normalized) {
    return undefined
  }

  if (normalized.startsWith("data:image/")) {
    return isSafeBrandLogoDataUrl(normalized) ? normalized : undefined
  }

  if (
    normalized.startsWith("/") ||
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

export function resolveMetadataBrandLogoUrl(brandLogoUrl: string): string {
  return brandLogoUrl.startsWith("data:") ? DEFAULT_SITE_BRANDING.brandLogoUrl : brandLogoUrl
}

export function buildSiteTitle(locale: string, brandName: string): string {
  if (brandName.trim() !== DEFAULT_SITE_BRANDING.brandName) {
    return brandName
  }

  return locale === "zh"
    ? `Temp Mail-临时邮件-安全、即时、快速- ${brandName}`
    : `Temp Mail - Secure, Instant, Fast - ${brandName}`
}

export function buildSiteDescription(locale: string, brandName: string): string {
  return locale === "zh"
    ? `使用 ${brandName} 保护您的个人邮箱地址免受垃圾邮件、机器人、钓鱼和其他在线滥用。`
    : `Protect your personal email address from spam, bots, phishing, and other online abuse with ${brandName}.`
}

export function replaceBrandNameText(text: string, brandName: string): string {
  return text.replaceAll("TmpMail", brandName)
}
