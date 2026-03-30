import DomainManagementPage from "@/components/domain-management-page"
import { getAdminEntryPath } from "@/lib/admin-entry"

export const dynamic = "force-dynamic"

export default function AdminPage() {
  return <DomainManagementPage entryPath={getAdminEntryPath()} />
}
