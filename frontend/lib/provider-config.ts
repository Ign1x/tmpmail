import type { ApiProvider } from "@/types"

function getEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

function getOptionalEnv(name: string): string {
  return process.env[name]?.trim() || ""
}

export const DEFAULT_PROVIDER_ID = getEnv("NEXT_PUBLIC_TMPMAIL_PROVIDER_ID", "tmpmail")
export const DEFAULT_PROVIDER_NAME = getEnv("NEXT_PUBLIC_TMPMAIL_PROVIDER_NAME", "TmpMail")
export const DEFAULT_PROVIDER_BASE_URL = getEnv("NEXT_PUBLIC_TMPMAIL_API_BASE_URL", "http://127.0.0.1:8080")
export const DEFAULT_DOMAIN = getEnv("NEXT_PUBLIC_TMPMAIL_DEFAULT_DOMAIN", "")
export const BRAND_NAME = getEnv("NEXT_PUBLIC_TMPMAIL_BRAND_NAME", DEFAULT_PROVIDER_NAME)
export const BRAND_DOMAIN = getOptionalEnv("NEXT_PUBLIC_TMPMAIL_BRAND_DOMAIN") || DEFAULT_DOMAIN
export const BRAND_LABEL = BRAND_DOMAIN || BRAND_NAME
export const EXAMPLE_DOMAIN = "mail.example.com"
export const EXAMPLE_EMAIL = `example@${DEFAULT_DOMAIN || EXAMPLE_DOMAIN}`
export const BRAND_REPO_URL = process.env.NEXT_PUBLIC_TMPMAIL_REPO_URL?.trim() || ""
export const QUICK_CREATE_PASSWORD = process.env.NEXT_PUBLIC_TMPMAIL_QUICK_CREATE_PASSWORD?.trim() || ""

type PresetProvider = ApiProvider & {
  enabledByDefault: boolean
}

const presetProviderDefinitions: PresetProvider[] = [
  {
    id: DEFAULT_PROVIDER_ID,
    name: DEFAULT_PROVIDER_NAME,
    baseUrl: DEFAULT_PROVIDER_BASE_URL,
    enabledByDefault: true,
    isCustom: false,
  },
]

export const PRESET_PROVIDER_DEFINITIONS = presetProviderDefinitions
export const PRESET_PROVIDERS: ApiProvider[] = PRESET_PROVIDER_DEFINITIONS.map(({ enabledByDefault, ...provider }) => provider)

export function getDefaultProviderConfig(): ApiProvider {
  return PRESET_PROVIDERS[0]
}

export function getPresetProviderConfig(providerId: string): ApiProvider | undefined {
  return PRESET_PROVIDERS.find((provider) => provider.id === providerId)
}

export function getDefaultDisabledProviderIds(): string[] {
  return PRESET_PROVIDER_DEFINITIONS
    .filter((provider) => !provider.enabledByDefault)
    .map((provider) => provider.id)
}

export function getProviderName(providerId: string): string {
  return getPresetProviderConfig(providerId)?.name || providerId
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
