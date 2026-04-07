"use client"

import { useEffect, useSyncExternalStore } from "react"

import AdminEntryPage from "@/components/admin-entry-page"
import DomainManagementPage from "@/components/domain-management-page"
import {
  hasStoredAdminSession,
  setStoredAdminSession,
  subscribeToAdminSession,
} from "@/lib/admin-session"

interface WorkspaceRouteClientProps {
  entryPath: string
  requireSecureTransport: boolean
  initialHasServerSession: boolean
}

export default function WorkspaceRouteClient({
  entryPath,
  requireSecureTransport,
  initialHasServerSession,
}: WorkspaceRouteClientProps) {
  useEffect(() => {
    if (!initialHasServerSession) {
      return
    }

    setStoredAdminSession()
  }, [initialHasServerSession])

  const showConsole = useSyncExternalStore(
    subscribeToAdminSession,
    hasStoredAdminSession,
    () => initialHasServerSession,
  )

  if (showConsole) {
    return (
      <DomainManagementPage
        entryPath={entryPath}
        requireSecureTransport={requireSecureTransport}
      />
    )
  }

  return (
    <AdminEntryPage
      consolePath={entryPath}
      requireSecureTransport={requireSecureTransport}
    />
  )
}
