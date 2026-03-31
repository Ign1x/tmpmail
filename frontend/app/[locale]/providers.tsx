"use client"

import type React from "react"
import { useEffect } from "react"

import { HeroUIProvider } from "@heroui/system"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { ToastProvider } from "@heroui/toast"
import { removeStoredValue } from "@/lib/storage"

function LegacyProviderStorageCleanup() {
  useEffect(() => {
    removeStoredValue("custom-api-providers")
    removeStoredValue("disabled-api-providers")
  }, [])

  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <HeroUIProvider>
      <NextThemesProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <LegacyProviderStorageCleanup />
        {children}
        <ToastProvider
          placement="bottom-center"
          maxVisibleToasts={3}
          toastProps={{
            color: "primary",
            variant: "flat",
            radius: "md",
            timeout: 4000,
          }}
        />
      </NextThemesProvider>
    </HeroUIProvider>
  )
}
