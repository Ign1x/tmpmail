import AdminEntryPage from "@/components/admin-entry-page"
import DomainManagementPage from "@/components/domain-management-page"
import { hasValidServerAdminSession } from "@/lib/admin-server-session"

export const dynamic = "force-dynamic"

function isAdminSecureTransportRequired(): boolean {
  const value = process.env.TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT?.trim().toLowerCase()

  if (!value) {
    return true
  }

  return !["0", "false", "no", "off"].includes(value)
}

export default async function LocaleHomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const homePath = `/${locale}`
  const requireSecureTransport = isAdminSecureTransportRequired()

  if (await hasValidServerAdminSession()) {
    return (
      <DomainManagementPage
        entryPath={homePath}
        requireSecureTransport={requireSecureTransport}
      />
    )
  }

  return (
    <AdminEntryPage
      consolePath={homePath}
      requireSecureTransport={requireSecureTransport}
    />
  )
}
