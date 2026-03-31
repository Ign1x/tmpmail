"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { Button } from "@heroui/button"
import { Languages, Mail, Menu, RefreshCw, Wifi, X } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { usePathname, useRouter } from "@/i18n/navigation"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { useAuth } from "@/contexts/auth-context"
import { useMailStatus } from "@/contexts/mail-status-context"
import Header from "@/components/header"
import Sidebar from "@/components/sidebar"
import AccountModal from "@/components/account-modal"
import LoginModal from "@/components/login-modal"
import UpdateNoticeModal from "@/components/update-notice-modal"
import { fetchPublicUpdateNotice, type PublicUpdateNotice } from "@/lib/api"
import { BRAND_LABEL, BRAND_NAME, BRAND_REPO_URL } from "@/lib/provider-config"

interface AppShellProps {
  activeItem: "inbox"
  children: ReactNode
  banner?: ReactNode
  autoOpenUpdateNotice?: boolean
  onActivateInbox?: () => void
  onRefreshInbox?: () => void
}

const UPDATE_NOTICE_STORAGE_KEY_PREFIX = "tmpmail-update-notice"

export default function AppShell({
  activeItem,
  children,
  banner,
  autoOpenUpdateNotice = false,
  onActivateInbox,
  onRefreshInbox,
}: AppShellProps) {
  const [isPending, startTransition] = useTransition()
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false)
  const [loginAccountAddress, setLoginAccountAddress] = useState("")
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isUpdateNoticeModalOpen, setIsUpdateNoticeModalOpen] = useState(false)
  const [updateNotice, setUpdateNotice] = useState<PublicUpdateNotice | null>(null)
  const { toast } = useHeroUIToast()
  const isMobile = useIsMobile()
  const { isAuthenticated, currentAccount } = useAuth()
  const { isEnabled, connectionState } = useMailStatus()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations("mainPage")
  const tm = useTranslations("messageList")
  const ts = useTranslations("sidebar")

  useEffect(() => {
    let active = true

    const loadUpdateNotice = async () => {
      try {
        const notice = await fetchPublicUpdateNotice()
        if (active) {
          setUpdateNotice(notice)
        }
      } catch {
        if (active) {
          setUpdateNotice(null)
        }
      }
    }

    void loadUpdateNotice()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!autoOpenUpdateNotice || typeof window === "undefined" || !updateNotice?.enabled || !updateNotice.autoOpen) {
      return
    }

    const storageKey = `${UPDATE_NOTICE_STORAGE_KEY_PREFIX}:${updateNotice.version}`
    const noticeShown = localStorage.getItem(storageKey)
    if (noticeShown) {
      return
    }

    const timer = setTimeout(() => {
      setIsUpdateNoticeModalOpen(true)
      localStorage.setItem(storageKey, "true")
    }, 500)

    return () => clearTimeout(timer)
  }, [autoOpenUpdateNotice, updateNotice])

  const handleLocaleChange = () => {
    const newLocale = locale === "en" ? "zh" : "en"
    startTransition(() => {
      router.replace(pathname, { locale: newLocale })
    })

    toast({
      title: newLocale === "en" ? t("switchedToEn") : t("switchedToZh"),
      color: "primary",
      variant: "flat",
      icon: <Languages size={16} />,
    })
  }

  const handleSidebarItemClick = (item: string) => {
    if (item === "inbox") {
      if (activeItem === "inbox") {
        onActivateInbox?.()
      } else {
        router.push("/")
      }
      return
    }

    if (item === "refresh") {
      toast({
        title: t("refreshing"),
        color: "primary",
        variant: "flat",
        icon: <RefreshCw size={16} />,
      })

      if (activeItem === "inbox") {
        onActivateInbox?.()
        onRefreshInbox?.()
      } else {
        router.push("/")
      }
      return
    }

    if (item === "update-notice") {
      if (updateNotice?.enabled) {
        setIsUpdateNoticeModalOpen(true)
      }
      return
    }

    if (item === "github") {
      if (!BRAND_REPO_URL) {
        return
      }
      window.open(BRAND_REPO_URL, "_blank", "noopener,noreferrer")
      return
    }

    if (item === "faq") {
      window.open(`/${locale}/faq`, "_blank", "noopener,noreferrer")
      return
    }

    if (item === "api") {
      window.open(`/${locale}/api-docs`, "_blank", "noopener,noreferrer")
      return
    }

    if (item === "privacy") {
      window.open(`/${locale}/privacy`, "_blank", "noopener,noreferrer")
    }
  }

  const handleMobileSidebarItemClick = (item: string) => {
    handleSidebarItemClick(item)
    setIsSidebarOpen(false)
  }

  const mobileStatusLabel =
    !isAuthenticated || !currentAccount
      ? BRAND_NAME
      : !isEnabled
        ? tm("streamPaused")
        : connectionState === "connected"
          ? tm("streamConnected")
          : connectionState === "reconnecting"
            ? tm("streamReconnecting")
            : connectionState === "error"
              ? tm("streamError")
              : tm("streamConnecting")

  const mobileSectionLabel = ts("inbox")

  return (
    <>
      <div
        className={`relative flex min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef4ff_45%,#f6f8fb_100%)] text-gray-800 transition-opacity duration-200 dark:bg-[linear-gradient(180deg,#020617_0%,#0f172a_55%,#111827_100%)] dark:text-gray-100 ${
          isPending ? "pointer-events-none opacity-60" : "opacity-100"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.12),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.42),transparent_30%)]" />

        {!isMobile && (
          <div className="relative hidden h-screen px-4 py-4 md:block">
            <Sidebar activeItem={activeItem} onItemClick={handleSidebarItemClick} />
          </div>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden md:py-4 md:pr-4">
          <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden border border-white/65 bg-white/70 shadow-[0_30px_90px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/70 dark:shadow-none md:rounded-[2rem]">
          {isMobile && (
            <div className="border-b border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
              <div className="flex items-center justify-between gap-2">
                <Button
                  isIconOnly
                  variant="light"
                  size="sm"
                  onPress={() => setIsSidebarOpen(true)}
                  className="text-gray-600 dark:text-gray-300"
                  aria-label={t("openMenu")}
                >
                  <Menu size={20} />
                </Button>
                <div className="min-w-0 flex-1 px-2">
                  <div className="flex items-center justify-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-xl">
                      <img
                        src="https://img.116119.xyz/img/2025/06/08/547d9cd9739b8e15a51e510342af3fb0.png"
                        alt={`${BRAND_NAME} Logo`}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <span className="truncate text-base font-semibold text-slate-800 dark:text-white">
                      {BRAND_LABEL}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <Wifi size={11} className={isAuthenticated && isEnabled ? "text-emerald-500" : "text-slate-400"} />
                    <span className="truncate">{mobileStatusLabel}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    isIconOnly
                    variant="light"
                    size="sm"
                    onPress={() => handleSidebarItemClick("refresh")}
                    className="text-gray-600 dark:text-gray-300"
                    aria-label={ts("refresh")}
                  >
                    <RefreshCw size={17} />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
                <button
                  type="button"
                  onClick={() => handleSidebarItemClick(activeItem === "inbox" ? "refresh" : "inbox")}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200"
                >
                  <Mail size={13} />
                  {currentAccount ? currentAccount.address : mobileSectionLabel}
                </button>
              </div>
            </div>
          )}

          <Header
            onCreateAccount={() => setIsAccountModalOpen(true)}
            onLocaleChange={handleLocaleChange}
            onLogin={() => setIsLoginModalOpen(true)}
            isMobile={isMobile}
          />

          {banner}

          <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>

        {isMobile && isSidebarOpen && (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] transition-opacity duration-300"
              onClick={() => setIsSidebarOpen(false)}
            />
            <div className="absolute left-0 top-0 h-full w-[18rem] max-w-[85vw] bg-transparent p-3">
              <div className="flex h-full flex-col rounded-[1.75rem] border border-white/60 bg-white/92 shadow-[0_24px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/92">
                <div className="border-b border-slate-200/80 p-4 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-lg">
                        <img
                          src="https://img.116119.xyz/img/2025/06/08/547d9cd9739b8e15a51e510342af3fb0.png"
                          alt={`${BRAND_NAME} Logo`}
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <span className="text-lg font-semibold text-gray-800 dark:text-white">
                        {BRAND_LABEL}
                      </span>
                    </div>
                    <Button
                      isIconOnly
                      variant="light"
                      size="sm"
                      onPress={() => setIsSidebarOpen(false)}
                      className="text-gray-600 dark:text-gray-300"
                      aria-label={t("closeMenu")}
                    >
                      <X size={18} />
                    </Button>
                  </div>
                </div>
                <Sidebar
                  activeItem={activeItem}
                  onItemClick={handleMobileSidebarItemClick}
                  isMobile={true}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <AccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
      />
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => {
          setIsLoginModalOpen(false)
          setLoginAccountAddress("")
        }}
        accountAddress={loginAccountAddress}
      />
      <UpdateNoticeModal
        isOpen={isUpdateNoticeModalOpen}
        onClose={() => setIsUpdateNoticeModalOpen(false)}
        notice={updateNotice}
        locale={locale}
      />
    </>
  )
}
