import { redirect } from "next/navigation"

import AdminEntryPage from "@/components/admin-entry-page"
import { getAdminConsoleEntryPath, getAdminEntryPath } from "@/lib/admin-entry"
import { hasValidServerAdminSession } from "@/lib/admin-server-session"

export const dynamic = "force-dynamic"

function isAdminSecureTransportRequired(): boolean {
  const value = process.env.TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT?.trim().toLowerCase()

  if (!value) {
    return true
  }

  return !["0", "false", "no", "off"].includes(value)
}

export default async function AdminPage() {
  if (await hasValidServerAdminSession()) {
    redirect(getAdminConsoleEntryPath())
  }

  return (
    <AdminEntryPage
      entryPath={getAdminEntryPath()}
      consolePath={getAdminConsoleEntryPath()}
      requireSecureTransport={isAdminSecureTransportRequired()}
    />
  )
}
