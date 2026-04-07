"use client"

const ADMIN_SESSION_STORAGE_KEY = "tmpmail-admin-session-present"
const ADMIN_PENDING_SESSION_STORAGE_KEY = "tmpmail-admin-pending-session"
const ADMIN_SESSION_EVENT = "tmpmail-admin-session-change"
const ADMIN_SESSION_BROADCAST_KEY = "tmpmail-admin-session-broadcast"
const ADMIN_REVEALED_KEYS_STORAGE_KEY = "tmpmail-admin-revealed-keys"
const ADMIN_PENDING_REVEALED_KEY_STORAGE_KEY = "tmpmail-admin-revealed-key"

export type StoredAdminKey = {
  apiKey: string
  expiresAt: number
}

export type StoredAdminKeyMap = Record<string, StoredAdminKey>

function broadcastAdminSessionChange(): void {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new Event(ADMIN_SESSION_EVENT))

  try {
    localStorage.setItem(ADMIN_SESSION_BROADCAST_KEY, String(Date.now()))
    localStorage.removeItem(ADMIN_SESSION_BROADCAST_KEY)
  } catch {}
}

export function hasStoredAdminSession(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  try {
    return sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function setStoredAdminSession(): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, "1")
  } catch {}

  broadcastAdminSessionChange()
}

export function clearStoredAdminSession(): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
    sessionStorage.removeItem(ADMIN_PENDING_SESSION_STORAGE_KEY)
  } catch {}

  broadcastAdminSessionChange()
}

export function storePendingAdminSession(session: unknown): void {
  if (typeof window === "undefined" || !session || typeof session !== "object" || Array.isArray(session)) {
    return
  }

  try {
    sessionStorage.setItem(ADMIN_PENDING_SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {}
}

export function takePendingAdminSession<T = unknown>(): T | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const raw = sessionStorage.getItem(ADMIN_PENDING_SESSION_STORAGE_KEY)
    sessionStorage.removeItem(ADMIN_PENDING_SESSION_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }

    return parsed as T
  } catch {
    try {
      sessionStorage.removeItem(ADMIN_PENDING_SESSION_STORAGE_KEY)
    } catch {}
    return null
  }
}

export function subscribeToAdminSession(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }

  const handleWindowEvent = () => listener()
  const handleStorageEvent = (event: StorageEvent) => {
    if (
      !event.key ||
      event.key === ADMIN_SESSION_STORAGE_KEY ||
      event.key === ADMIN_SESSION_BROADCAST_KEY
    ) {
      listener()
    }
  }

  window.addEventListener(ADMIN_SESSION_EVENT, handleWindowEvent)
  window.addEventListener("storage", handleStorageEvent)

  return () => {
    window.removeEventListener(ADMIN_SESSION_EVENT, handleWindowEvent)
    window.removeEventListener("storage", handleStorageEvent)
  }
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
