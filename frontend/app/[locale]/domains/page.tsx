import { redirect } from "next/navigation"

import { getAdminEntryPath } from "@/lib/admin-entry"

export const dynamic = "force-dynamic"

export default async function DomainsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  await params
  redirect(getAdminEntryPath())
}
