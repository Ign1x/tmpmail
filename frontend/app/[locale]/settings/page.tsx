import AppShell from "@/components/app-shell"
import ProviderSettingsPage from "@/components/provider-settings-page"

export default function SettingsPage() {
  return (
    <AppShell activeItem="settings">
      <ProviderSettingsPage />
    </AppShell>
  )
}
