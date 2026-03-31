export function readStoredString(key: string): string | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function readStoredJson<T>(key: string, fallback: T): T {
  const rawValue = readStoredString(key)
  if (!rawValue) {
    return fallback
  }

  try {
    return JSON.parse(rawValue) as T
  } catch {
    return fallback
  }
}

export function writeStoredString(key: string, value: string): boolean {
  if (typeof window === "undefined") {
    return false
  }

  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function writeStoredJson(key: string, value: unknown): boolean {
  try {
    return writeStoredString(key, JSON.stringify(value))
  } catch {
    return false
  }
}

export function removeStoredValue(key: string): boolean {
  if (typeof window === "undefined") {
    return false
  }

  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
