"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { Button } from "@heroui/button"
import { Bell, Languages, Mail, Menu, RefreshCw, Wifi, X } from "lucide-react"
import Image from "next/image"
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
  autoOpenNotice?: boolean
  onActivateInbox?: () => void
  onRefreshInbox?: () => void
}

const NOTICE_STORAGE_KEY_PREFIX = "tmpmail-notice"

export default function AppShell({
  activeItem,
  children,
  banner,
  autoOpenNotice = false,
  onActivateInbox,
  onRefreshInbox,
}: AppShellProps) {
  const [isPending, startTransition] = useTransition()
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false)
  const [loginAccountAddress, setLoginAccountAddress] = useState("")
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isNoticeModalOpen, setIsNoticeModalOpen] = useState(false)
  const [notice, setNotice] = useState<PublicUpdateNotice | null>(null)
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

    const loadNotice = async () => {
      try {
        const nextNotice = await fetchPublicUpdateNotice()
        if (active) {
          setNotice(nextNotice)
        }
      } catch {
        if (active) {
          setNotice(null)
        }
      }
    }

    void loadNotice()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!autoOpenNotice || typeof window === "undefined" || !notice?.enabled || !notice.autoOpen) {
      return
    }

    const storageKey = `${NOTICE_STORAGE_KEY_PREFIX}:${notice.version}`
    const noticeShown = localStorage.getItem(storageKey)
    if (noticeShown) {
      return
    }

    const timer = setTimeout(() => {
      setIsNoticeModalOpen(true)
      localStorage.setItem(storageKey, "true")
    }, 500)

    return () => clearTimeout(timer)
  }, [autoOpenNotice, notice])

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

    if (item === "notice") {
      if (notice?.enabled) {
        setIsNoticeModalOpen(true)
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
      router.push("/faq")
      return
    }

    if (item === "api") {
      router.push("/api-docs")
      return
    }

    if (item === "privacy") {
      router.push("/privacy")
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
  const showNoticeButton = Boolean(notice?.enabled)
  const mobileStatusTone =
    !isAuthenticated || !currentAccount || !isEnabled
      ? "bg-slate-400"
      : connectionState === "connected"
        ? "bg-emerald-500"
        : connectionState === "error"
          ? "bg-rose-500"
          : "bg-amber-500"

  return (
    <>
      <div
        className={`tm-page-backdrop relative flex min-h-screen overflow-hidden text-gray-800 transition-opacity duration-200 dark:text-gray-100 ${
          isPending ? "pointer-events-none opacity-60" : "opacity-100"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:40px_40px] opacity-[0.14] dark:bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)]" />

        {!isMobile && (
          <div className="relative hidden h-screen px-4 py-4 md:block">
            <Sidebar
              activeItem={activeItem}
              onItemClick={handleSidebarItemClick}
              hasNotice={Boolean(notice?.enabled)}
            />
          </div>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden md:py-4 md:pr-4">
          <div className="tm-glass-panel flex h-full min-w-0 flex-1 flex-col overflow-hidden md:rounded-[2rem]">
            {isMobile && (
              <div className="border-b border-slate-200/80 bg-white/82 px-4 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/82">
                <div className="flex items-center justify-between gap-3">
                  <Button
                    isIconOnly
                    variant="light"
                    size="sm"
                    onPress={() => setIsSidebarOpen(true)}
                    className="tm-icon-button h-10 w-10 min-w-10"
                    aria-label={t("openMenu")}
                  >
                    <Menu size={18} />
                  </Button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-2xl bg-sky-100 dark:bg-sky-950/40">
                        <Image src="/brand-mark.svg" alt={`${BRAND_NAME} Logo`} width={24} height={24} className="h-6 w-6 object-contain" />
                      </div>
                      <span className="truncate text-base font-semibold text-slate-800 dark:text-white">
                        {BRAND_LABEL}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className={`h-2 w-2 rounded-full ${mobileStatusTone}`} />
                      <span className="truncate">{mobileStatusLabel}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {showNoticeButton && (
                      <Button
                        isIconOnly
                        variant="light"
                        size="sm"
                        onPress={() => handleSidebarItemClick("notice")}
                        className="tm-icon-button h-10 w-10 min-w-10"
                        aria-label={ts("notice")}
                      >
                        <Bell size={16} />
                      </Button>
                    )}
                    <Button
                      isIconOnly
                      variant="light"
                      size="sm"
                      onPress={() => handleSidebarItemClick("refresh")}
                      className="tm-icon-button h-10 w-10 min-w-10"
                      aria-label={ts("refresh")}
                    >
                      <RefreshCw size={16} />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
                  <button
                    type="button"
                    onClick={() => handleSidebarItemClick(activeItem === "inbox" ? "refresh" : "inbox")}
                    className="tm-chip shrink-0"
                  >
                    <Mail size={13} />
                    {currentAccount ? currentAccount.address : mobileSectionLabel}
                  </button>
                  <span className="tm-chip shrink-0">
                    <Wifi size={13} />
                    {mobileStatusLabel}
                  </span>
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
              <div className="flex h-full flex-col rounded-[1.9rem] border border-white/65 bg-white/92 shadow-[0_24px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/92">
                <div className="border-b border-slate-200/80 p-4 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-xl bg-sky-100 dark:bg-sky-950/40">
                        <Image
                          src="/brand-mark.svg"
                          alt={`${BRAND_NAME} Logo`}
                          width={20}
                          height={20}
                          className="h-5 w-5 object-contain"
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
                      className="tm-icon-button h-9 w-9 min-w-9"
                      aria-label={t("closeMenu")}
                    >
                      <X size={18} />
                    </Button>
                  </div>
                </div>
                <Sidebar
                  activeItem={activeItem}
                  onItemClick={handleMobileSidebarItemClick}
                  hasNotice={Boolean(notice?.enabled)}
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
        isOpen={isNoticeModalOpen}
        onClose={() => setIsNoticeModalOpen(false)}
        notice={notice}
        locale={locale}
      />
    </>
  )
}
