"use client"

import { ADMIN_SESSION_COOKIE_KEY } from "@/lib/admin-session-cookie"

export const ADMIN_SESSION_STORAGE_KEY = ADMIN_SESSION_COOKIE_KEY
const ADMIN_REVEALED_KEYS_STORAGE_KEY = "tmpmail-admin-revealed-keys"
const ADMIN_PENDING_REVEALED_KEY_STORAGE_KEY = "tmpmail-admin-revealed-key"

export type StoredAdminKey = {
  apiKey: string
  expiresAt: number
}

export type StoredAdminKeyMap = Record<string, StoredAdminKey>

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

function createStoredAdminKey(apiKey: string, ttlMs: number): StoredAdminKey | null {
  const trimmedApiKey = apiKey.trim()
  if (!trimmedApiKey) {
    return null
  }

  return {
    apiKey: trimmedApiKey,
    expiresAt: Date.now() + Math.max(ttlMs, 1_000),
  }
}

function normalizeStoredAdminKey(value: unknown): StoredAdminKey | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const parsed = value as Partial<StoredAdminKey>
  if (
    typeof parsed.apiKey !== "string" ||
    !parsed.apiKey.trim() ||
    typeof parsed.expiresAt !== "number"
  ) {
    return null
  }

  if (parsed.expiresAt <= Date.now()) {
    return null
  }

  return {
    apiKey: parsed.apiKey.trim(),
    expiresAt: parsed.expiresAt,
  }
}

function writeStoredAdminKey(storageKey: string, payload: StoredAdminKey | null): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    if (payload) {
      sessionStorage.setItem(storageKey, JSON.stringify(payload))
      return
    }

    sessionStorage.removeItem(storageKey)
  } catch {}
}

function readStoredAdminKey(storageKey: string): StoredAdminKey | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) {
      return null
    }

    const parsed = normalizeStoredAdminKey(JSON.parse(raw))
    if (!parsed) {
      sessionStorage.removeItem(storageKey)
      return null
    }

    return parsed
  } catch {
    try {
      sessionStorage.removeItem(storageKey)
    } catch {}
    return null
  }
}

function writeStoredAdminKeyMap(payload: StoredAdminKeyMap): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    if (Object.keys(payload).length > 0) {
      sessionStorage.setItem(ADMIN_REVEALED_KEYS_STORAGE_KEY, JSON.stringify(payload))
      return
    }

    sessionStorage.removeItem(ADMIN_REVEALED_KEYS_STORAGE_KEY)
  } catch {}
}

export function storeRevealedAdminKey(keyId: string, apiKey: string, ttlMs: number): void {
  if (typeof window === "undefined") {
    return
  }

  const normalizedKeyId = keyId.trim()
  const payload = createStoredAdminKey(apiKey, ttlMs)
  if (!normalizedKeyId || !payload) {
    return
  }

  writeStoredAdminKeyMap({
    ...getStoredRevealedAdminKeys(),
    [normalizedKeyId]: payload,
  })
}

export function storePendingRevealedAdminKey(apiKey: string, ttlMs: number): void {
  writeStoredAdminKey(
    ADMIN_PENDING_REVEALED_KEY_STORAGE_KEY,
    createStoredAdminKey(apiKey, ttlMs),
  )
}

export function getStoredRevealedAdminKeys(): StoredAdminKeyMap {
  if (typeof window === "undefined") {
    return {}
  }

  try {
    const raw = sessionStorage.getItem(ADMIN_REVEALED_KEYS_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      sessionStorage.removeItem(ADMIN_REVEALED_KEYS_STORAGE_KEY)
      return {}
    }

    const entries = Object.entries(parsed as Record<string, unknown>)
    const nextPayload: StoredAdminKeyMap = {}

    for (const [keyId, value] of entries) {
      const normalizedKey = normalizeStoredAdminKey(value)
      if (normalizedKey) {
        nextPayload[keyId] = normalizedKey
      }
    }

    if (Object.keys(nextPayload).length !== entries.length) {
      writeStoredAdminKeyMap(nextPayload)
    }

    return nextPayload
  } catch {
    try {
      sessionStorage.removeItem(ADMIN_REVEALED_KEYS_STORAGE_KEY)
    } catch {}
    return {}
  }
}

export function getStoredRevealedAdminKey(keyId: string): StoredAdminKey | null {
  return getStoredRevealedAdminKeys()[keyId.trim()] ?? null
}

export function getStoredPendingRevealedAdminKey(): StoredAdminKey | null {
  return readStoredAdminKey(ADMIN_PENDING_REVEALED_KEY_STORAGE_KEY)
}

export function clearStoredPendingRevealedAdminKey(): void {
  writeStoredAdminKey(ADMIN_PENDING_REVEALED_KEY_STORAGE_KEY, null)
}

export function clearStoredRevealedAdminKey(keyId?: string): void {
  if (typeof window === "undefined") {
    return
  }

  const normalizedKeyId = keyId?.trim()
  if (!normalizedKeyId) {
    try {
      sessionStorage.removeItem(ADMIN_REVEALED_KEYS_STORAGE_KEY)
      sessionStorage.removeItem(ADMIN_PENDING_REVEALED_KEY_STORAGE_KEY)
    } catch {}
    return
  }

  const current = getStoredRevealedAdminKeys()
  if (!(normalizedKeyId in current)) {
    return
  }

  delete current[normalizedKeyId]
  writeStoredAdminKeyMap(current)
}
