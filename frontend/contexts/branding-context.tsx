"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type { SiteBrandingSettings } from "@/lib/api"
import {
  type ResolvedSiteBranding,
  DEFAULT_SITE_BRANDING,
  resolveSiteBranding,
} from "@/lib/site-branding"

type BrandingContextValue = ResolvedSiteBranding & {
  setBranding: (branding?: SiteBrandingSettings | null) => void
}

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined)

export function BrandingProvider({
  children,
  initialBranding = DEFAULT_SITE_BRANDING,
}: {
  children: ReactNode
  initialBranding?: ResolvedSiteBranding
}) {
  const [branding, setBrandingState] = useState<ResolvedSiteBranding>(initialBranding)

  useEffect(() => {
    setBrandingState(initialBranding)
  }, [initialBranding])

  const setBranding = useCallback((nextBranding?: SiteBrandingSettings | null) => {
    setBrandingState(resolveSiteBranding(nextBranding))
  }, [])

  const value = useMemo(
    () => ({
      ...branding,
      setBranding,
    }),
    [branding, setBranding],
  )

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useBranding(): BrandingContextValue {
  const context = useContext(BrandingContext)
  if (!context) {
    throw new Error("useBranding must be used within a BrandingProvider")
  }

  return context
}
