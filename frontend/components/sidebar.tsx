"use client"

import { Avatar } from "@heroui/avatar"
import { Button } from "@heroui/button"
import { Card } from "@heroui/card"
import { Bell, Code, ExternalLink, HelpCircle, Mail, MessageSquare, RefreshCw, Settings2, Sparkles, Wifi } from "lucide-react"
import { useTranslations } from "next-intl"
import { useAuth } from "@/contexts/auth-context"
import { useMailStatus } from "@/contexts/mail-status-context"
import { BRAND_LABEL, BRAND_NAME, BRAND_REPO_URL, DEFAULT_PROVIDER_ID, getProviderAccentClass, getProviderName } from "@/lib/provider-config"

interface SidebarProps {
  activeItem: string
  onItemClick: (item: string) => void
  isMobile?: boolean
}

export default function Sidebar({ activeItem, onItemClick, isMobile = false }: SidebarProps) {
  const t = useTranslations("sidebar")
  const tm = useTranslations("messageList")
  const { isAuthenticated, currentAccount, accounts } = useAuth()
  const { isEnabled, connectionState } = useMailStatus()

  const currentProviderId = currentAccount?.providerId || DEFAULT_PROVIDER_ID
  const streamLabel =
    !isAuthenticated
      ? t("guestModeTitle")
      : !isEnabled
        ? tm("streamPaused")
        : connectionState === "connected"
          ? tm("streamConnected")
          : connectionState === "reconnecting"
            ? tm("streamReconnecting")
            : connectionState === "error"
              ? tm("streamError")
              : tm("streamConnecting")
  const streamTone =
    !isAuthenticated || !isEnabled
      ? "border-slate-200 bg-white/70 text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300"
      : connectionState === "connected"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
        : connectionState === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
          : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"

  const menuItems = [
    { id: "inbox", label: t("inbox"), icon: Mail },
    { id: "refresh", label: t("refresh"), icon: RefreshCw },
  ]

  const bottomItems = [
    { id: "settings", label: t("settings"), icon: Settings2 },
    { id: "update-notice", label: t("updates"), icon: Bell },
    { id: "api", label: t("api"), icon: Code },
    { id: "faq", label: t("faq"), icon: HelpCircle },
    { id: "privacy", label: t("privacy"), icon: MessageSquare },
    ...(BRAND_REPO_URL ? [{ id: "github", label: "GitHub", icon: ExternalLink }] : []),
  ]

  return (
    <Card className={`flex ${isMobile ? "h-full w-72 rounded-none" : "h-full w-72 rounded-[2rem]"} flex-col overflow-hidden border border-white/65 bg-white/80 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 dark:shadow-none`}>
      {!isMobile && (
        <div className="border-b border-slate-200/80 px-5 py-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
              <img
                src="https://img.116119.xyz/img/2025/06/08/547d9cd9739b8e15a51e510342af3fb0.png"
                alt={`${BRAND_NAME} Logo`}
                className="h-8 w-8 object-contain"
              />
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-white">
                {BRAND_LABEL}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {t("workspaceSubtitle")}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 pb-4 pt-4">
        <div className="rounded-[1.6rem] border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-sky-50/70 p-4 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-sky-950/20">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Sparkles size={13} />
            {t("workspace")}
          </div>

          <div className="mt-4 flex items-start gap-3">
            {isAuthenticated && currentAccount ? (
              <Avatar
                name={currentAccount.address.slice(0, 2).toUpperCase()}
                size="sm"
                className="flex-shrink-0 bg-sky-500 text-white"
              />
            ) : (
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                <Mail size={16} />
              </div>
            )}

            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                {isAuthenticated && currentAccount ? currentAccount.address : t("guestModeTitle")}
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {isAuthenticated && currentAccount
                  ? getProviderName(currentProviderId)
                  : t("guestModeDesc")}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${streamTone}`}>
              <Wifi size={12} />
              {streamLabel}
            </div>
            {isAuthenticated && (
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                <div className={`h-2 w-2 rounded-full ${getProviderAccentClass(currentProviderId, "soft")}`} />
                {t("accountCount", { count: accounts.length })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 space-y-3">
        {menuItems.map((item) => {
          const Icon = item.icon
          return (
            <Button
              key={item.id}
              variant={activeItem === item.id ? "flat" : "light"}
              color={activeItem === item.id ? "primary" : "default"}
              className={`w-full justify-start rounded-2xl ${activeItem === item.id ? "h-12 bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100" : "h-11 text-slate-700 dark:text-slate-300"}`}
              startContent={<Icon size={20} />}
              onPress={() => onItemClick(item.id)}
            >
              {item.label}
            </Button>
          )
        })}
      </div>

      <div className="flex-grow" />

      <div className="space-y-2 border-t border-slate-200/80 p-4 dark:border-slate-800">
        {bottomItems.map((item) => {
          const Icon = item.icon
          return (
            <Button
              key={item.id}
              variant={activeItem === item.id ? "flat" : "light"}
              size="md"
              color={activeItem === item.id ? "primary" : "default"}
              className={`w-full justify-start rounded-2xl ${activeItem === item.id ? "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100" : "text-sm text-slate-600 dark:text-slate-300"}`}
              startContent={<Icon size={16} />}
              onPress={() => onItemClick(item.id)}
            >
              {item.label}
            </Button>
          )
        })}

        <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-400 dark:border-slate-800">
          © {BRAND_LABEL}
        </div>
      </div>
    </Card>
  )
}
