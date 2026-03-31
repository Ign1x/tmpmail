"use client"

import { useSyncExternalStore } from "react"

function subscribe(): () => void {
  return () => {}
}

function getClientSnapshot(): boolean {
  return true
}

function getServerSnapshot(): boolean {
  return false
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
