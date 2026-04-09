function getEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

function getOptionalEnv(name: string): string {
  return process.env[name]?.trim() || ""
}

export const DEFAULT_PROVIDER_ID = "tmpmail"
export const DEFAULT_PROVIDER_NAME = "TmpMail"
export const DEFAULT_PROVIDER_BASE_URL = "http://127.0.0.1:8080"
export const DEFAULT_DOMAIN = getEnv("NEXT_PUBLIC_TMPMAIL_DEFAULT_DOMAIN", "")
export const BRAND_NAME = getEnv("NEXT_PUBLIC_TMPMAIL_BRAND_NAME", DEFAULT_PROVIDER_NAME)
export const DEFAULT_BRAND_LOGO_URL = "/brand-mark.svg"
export const BRAND_DOMAIN = getOptionalEnv("NEXT_PUBLIC_TMPMAIL_BRAND_DOMAIN") || DEFAULT_DOMAIN
export const BRAND_LABEL = BRAND_NAME
export const EXAMPLE_DOMAIN = "mail.example.com"
export const EXAMPLE_EMAIL = `example@${DEFAULT_DOMAIN || EXAMPLE_DOMAIN}`
export const BRAND_REPO_URL = process.env.NEXT_PUBLIC_TMPMAIL_REPO_URL?.trim() || ""

export function getProviderName(providerId: string): string {
  return providerId === DEFAULT_PROVIDER_ID ? DEFAULT_PROVIDER_NAME : providerId
}

export function getProviderAccentClass(providerId: string, tone: "strong" | "soft" = "strong"): string {
  if (providerId === DEFAULT_PROVIDER_ID) {
    return tone === "strong" ? "bg-sky-500" : "bg-sky-400"
  }

  switch (providerId) {
    default:
      return tone === "strong" ? "bg-amber-500" : "bg-amber-400"
  }
}
