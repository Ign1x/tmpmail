"use client"

import { ADMIN_SESSION_COOKIE_KEY } from "@/lib/admin-session-cookie"

export const ADMIN_SESSION_STORAGE_KEY = ADMIN_SESSION_COOKIE_KEY
const ADMIN_REVEALED_KEY_STORAGE_KEY = "tmpmail-admin-revealed-key"

type StoredAdminKey = {
  apiKey: string
  expiresAt: number
}

function getCookie(name: string): string {
  if (typeof document === "undefined") {
    return ""
  }

  const cookiePrefix = `${encodeURIComponent(name)}=`
  const rawValue = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookiePrefix))
    ?.slice(cookiePrefix.length)
    .trim()

  return rawValue ? decodeURIComponent(rawValue) : ""
}

function setSessionCookie(token: string): void {
  if (typeof document === "undefined") {
    return
  }

  const isSecure =
    typeof window !== "undefined" && window.location.protocol.toLowerCase() === "https:"
  document.cookie = [
    `${encodeURIComponent(ADMIN_SESSION_COOKIE_KEY)}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    isSecure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ")
}

function clearSessionCookie(): void {
  if (typeof document === "undefined") {
    return
  }

  const isSecure =
    typeof window !== "undefined" && window.location.protocol.toLowerCase() === "https:"
  document.cookie = [
    `${encodeURIComponent(ADMIN_SESSION_COOKIE_KEY)}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
    isSecure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ")
}

export function getStoredAdminSession(): string {
  if (typeof window === "undefined") {
    return ""
  }

  try {
    const storedValue = sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY)?.trim() || ""
    if (storedValue) {
      return storedValue
    }
  } catch {}

  const cookieValue = getCookie(ADMIN_SESSION_COOKIE_KEY)

  if (!cookieValue) {
    return ""
  }

  try {
    sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, cookieValue)
  } catch {
    return cookieValue
  }

  return cookieValue
}

export function setStoredAdminSession(token: string): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, token)
  } catch {}

  setSessionCookie(token)
}

export function clearStoredAdminSession(): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
  } catch {}

  clearSessionCookie()
}

export function storeRevealedAdminKey(apiKey: string, ttlMs: number): void {
  if (typeof window === "undefined") {
    return
  }

  const payload: StoredAdminKey = {
    apiKey,
    expiresAt: Date.now() + Math.max(ttlMs, 1_000),
  }

  try {
    sessionStorage.setItem(ADMIN_REVEALED_KEY_STORAGE_KEY, JSON.stringify(payload))
  } catch {}
}

export function getStoredRevealedAdminKey(): StoredAdminKey | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const raw = sessionStorage.getItem(ADMIN_REVEALED_KEY_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<StoredAdminKey>
    if (
      typeof parsed.apiKey !== "string" ||
      !parsed.apiKey.trim() ||
      typeof parsed.expiresAt !== "number"
    ) {
      sessionStorage.removeItem(ADMIN_REVEALED_KEY_STORAGE_KEY)
      return null
    }

    if (parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(ADMIN_REVEALED_KEY_STORAGE_KEY)
      return null
    }

    return {
      apiKey: parsed.apiKey,
      expiresAt: parsed.expiresAt,
    }
  } catch {
    try {
      sessionStorage.removeItem(ADMIN_REVEALED_KEY_STORAGE_KEY)
    } catch {}
    return null
  }
}

export function clearStoredRevealedAdminKey(): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    sessionStorage.removeItem(ADMIN_REVEALED_KEY_STORAGE_KEY)
  } catch {}
}
