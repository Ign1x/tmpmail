import DomainManagementPage from "@/components/domain-management-page"
import { getAdminEntryPath } from "@/lib/admin-entry"

export const dynamic = "force-dynamic"

function isAdminSecureTransportRequired(): boolean {
  const value = process.env.TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT?.trim().toLowerCase()

  if (!value) {
    return true
  }

  return !["0", "false", "no", "off"].includes(value)
}

export default function AdminPage() {
  return (
    <DomainManagementPage
      entryPath={getAdminEntryPath()}
      requireSecureTransport={isAdminSecureTransportRequired()}
    />
  )
}
