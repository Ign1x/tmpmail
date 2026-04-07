import WorkspaceRouteClient from "@/components/workspace-route-client"
import { hasServerAdminSessionCookie } from "@/lib/admin-server-session"

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
  const initialHasServerSession = await hasServerAdminSessionCookie()

  return (
    <WorkspaceRouteClient
      entryPath={homePath}
      requireSecureTransport={requireSecureTransport}
      initialHasServerSession={initialHasServerSession}
    />
  )
}
