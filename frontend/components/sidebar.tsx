"use client"

import { Button } from "@heroui/button"
import { Card } from "@heroui/card"
import { Bell, Code, ExternalLink, HelpCircle, Mail, MessageSquare, RefreshCw, Wifi } from "lucide-react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { useAuth } from "@/contexts/auth-context"
import { useMailStatus } from "@/contexts/mail-status-context"
import {
  BRAND_LABEL,
  BRAND_NAME,
  BRAND_REPO_URL,
  DEFAULT_PROVIDER_ID,
  getProviderAccentClass,
  getProviderName,
} from "@/lib/provider-config"

interface SidebarProps {
  activeItem: string
  onItemClick: (item: string) => void
  hasNotice?: boolean
  isMobile?: boolean
}

function SidebarContent({
  activeItem,
  onItemClick,
  hasNotice,
}: Omit<SidebarProps, "isMobile">) {
  const t = useTranslations("sidebar")
  const tm = useTranslations("messageList")
  const { isAuthenticated, currentAccount, accounts } = useAuth()
  const { isEnabled, connectionState } = useMailStatus()

  const menuItems = [
    { id: "inbox", label: t("inbox"), icon: Mail },
    { id: "refresh", label: t("refresh"), icon: RefreshCw },
  ]

  const bottomItems = [
    ...(hasNotice ? [{ id: "notice", label: t("notice"), icon: Bell }] : []),
    { id: "api", label: t("api"), icon: Code },
    { id: "faq", label: t("faq"), icon: HelpCircle },
    { id: "privacy", label: t("privacy"), icon: MessageSquare },
    ...(BRAND_REPO_URL ? [{ id: "github", label: "GitHub", icon: ExternalLink }] : []),
  ]

  const connectionLabel =
    !isAuthenticated || !currentAccount
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

  const connectionTone =
    !isAuthenticated || !currentAccount || !isEnabled
      ? "bg-slate-400"
      : connectionState === "connected"
        ? "bg-emerald-500"
        : connectionState === "error"
          ? "bg-rose-500"
          : "bg-amber-500"

  const providerId = currentAccount?.providerId || DEFAULT_PROVIDER_ID
  const providerName = getProviderName(providerId)
  const providerAccent = getProviderAccentClass(providerId)

  return (
    <>
      <div className="border-b border-slate-200/80 px-5 py-5 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
            <Image src="/brand-mark.svg" alt={`${BRAND_NAME} Logo`} width={32} height={32} className="h-8 w-8 object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900 dark:text-white">{BRAND_LABEL}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("workspaceSubtitle")}</div>
          </div>
        </div>

        <div className="mt-5 rounded-[1.6rem] border border-slate-200/80 bg-slate-50/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/55">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isAuthenticated && currentAccount ? t("signedInState") : t("guestModeTitle")}
              </div>
              <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-slate-400">
                {isAuthenticated && currentAccount ? currentAccount.address : t("guestModeDesc")}
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300">
              {t("accountCount", { count: accounts.length })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="tm-chip">
              <span className={`h-2 w-2 rounded-full ${providerAccent}`} />
              {t("providerLabel")}: {providerName}
            </span>
            <span className="tm-chip">
              <Wifi size={13} />
              <span className={`h-2 w-2 rounded-full ${connectionTone}`} />
              {connectionLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5">
        <div className="tm-section-label mb-3 px-1">{t("primaryMenu")}</div>
        <div className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon
            const isActive = activeItem === item.id

            return (
              <Button
                key={item.id}
                variant={isActive ? "flat" : "light"}
                color={isActive ? "primary" : "default"}
                className={`h-12 w-full justify-start rounded-[1.25rem] px-3 transition-all duration-150 ${
                  isActive
                    ? "bg-sky-100 text-sky-900 shadow-sm dark:bg-sky-950/40 dark:text-sky-100"
                    : "text-slate-700 hover:bg-white/90 dark:text-slate-300 dark:hover:bg-slate-900/80"
                }`}
                startContent={
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
                      isActive
                        ? "bg-white/90 text-sky-700 dark:bg-sky-900/70 dark:text-sky-200"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400"
                    }`}
                  >
                    <Icon size={18} />
                  </div>
                }
                onPress={() => onItemClick(item.id)}
              >
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">{item.label}</span>
                  {isActive && <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />}
                </div>
              </Button>
            )
          })}
        </div>
      </div>

      <div className="flex-grow" />

      <div className="space-y-2 border-t border-slate-200/80 p-4 dark:border-slate-800">
        <div className="tm-section-label px-1 pb-1">{t("secondaryMenu")}</div>
        {bottomItems.map((item) => {
          const Icon = item.icon
          const isActive = activeItem === item.id

          return (
            <Button
              key={item.id}
              variant={isActive ? "flat" : "light"}
              color={isActive ? "primary" : "default"}
              className={`h-11 w-full justify-start rounded-[1.15rem] px-3 ${
                isActive
                  ? "bg-sky-100 text-sky-900 shadow-sm dark:bg-sky-950/40 dark:text-sky-100"
                  : "text-slate-600 hover:bg-white/85 dark:text-slate-300 dark:hover:bg-slate-900/80"
              }`}
              startContent={
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                    isActive
                      ? "bg-white/90 text-sky-700 dark:bg-sky-900/70 dark:text-sky-200"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  <Icon size={16} />
                </div>
              }
              onPress={() => onItemClick(item.id)}
            >
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">{item.label}</span>
                {item.id === "notice" && hasNotice && <span className="h-2 w-2 rounded-full bg-sky-500" />}
              </div>
            </Button>
          )
        })}

        <div className="mt-4 rounded-[1.2rem] border border-dashed border-slate-200/80 px-3 py-3 text-xs leading-6 text-slate-500 dark:border-slate-800 dark:text-slate-400">
          © {new Date().getFullYear()} {BRAND_LABEL}
        </div>
      </div>
    </>
  )
}

export default function Sidebar({
  activeItem,
  onItemClick,
  hasNotice = false,
  isMobile = false,
}: SidebarProps) {
  const content = <SidebarContent activeItem={activeItem} onItemClick={onItemClick} hasNotice={hasNotice} />

  if (isMobile) {
    return <div className="flex h-full flex-col overflow-hidden">{content}</div>
  }

  return (
    <Card className="flex h-full w-72 flex-col overflow-hidden rounded-[2rem] border border-white/65 bg-white/80 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 dark:shadow-none">
      {content}
    </Card>
  )
}
