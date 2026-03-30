"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { Button } from "@heroui/button"
import { Languages, Menu, RefreshCw, X } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { usePathname, useRouter } from "@/i18n/navigation"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import Header from "@/components/header"
import Sidebar from "@/components/sidebar"
import AccountModal from "@/components/account-modal"
import LoginModal from "@/components/login-modal"
import UpdateNoticeModal from "@/components/update-notice-modal"
import { BRAND_DOMAIN, BRAND_NAME, BRAND_REPO_URL } from "@/lib/provider-config"

interface AppShellProps {
  activeItem: "inbox" | "settings"
  children: ReactNode
  banner?: ReactNode
  autoOpenUpdateNotice?: boolean
  onActivateInbox?: () => void
  onRefreshInbox?: () => void
}

const UPDATE_NOTICE_STORAGE_KEY = "tmpmail-update-notice-2026-03-30"

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
  const { toast } = useHeroUIToast()
  const isMobile = useIsMobile()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations("mainPage")

  useEffect(() => {
    if (!autoOpenUpdateNotice || typeof window === "undefined") {
      return
    }

    const noticeShown = localStorage.getItem(UPDATE_NOTICE_STORAGE_KEY)
    if (noticeShown) {
      return
    }

    const timer = setTimeout(() => {
      setIsUpdateNoticeModalOpen(true)
      localStorage.setItem(UPDATE_NOTICE_STORAGE_KEY, "true")
    }, 500)

    return () => clearTimeout(timer)
  }, [autoOpenUpdateNotice])

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

    if (item === "settings") {
      router.push("/settings")
      return
    }

    if (item === "update-notice") {
      setIsUpdateNoticeModalOpen(true)
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

  return (
    <>
      <div
        className={`flex h-screen bg-gray-50 text-gray-800 transition-opacity duration-200 dark:bg-gray-900 dark:text-gray-100 ${
          isPending ? "pointer-events-none opacity-60" : "opacity-100"
        }`}
      >
        {!isMobile && (
          <Sidebar activeItem={activeItem} onItemClick={handleSidebarItemClick} />
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          {isMobile && (
            <div className="flex items-center justify-between border-b border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
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
              <div className="flex items-center space-x-2">
                <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-lg">
                  <img
                    src="https://img.116119.xyz/img/2025/06/08/547d9cd9739b8e15a51e510342af3fb0.png"
                    alt={`${BRAND_NAME} Logo`}
                    className="h-full w-full object-contain"
                  />
                </div>
                <span className="text-lg font-semibold text-gray-800 dark:text-white">
                  {BRAND_DOMAIN}
                </span>
              </div>
              <div className="w-8" />
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

        {isMobile && isSidebarOpen && (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/50 transition-opacity duration-300"
              onClick={() => setIsSidebarOpen(false)}
            />
            <div className="absolute left-0 top-0 h-full w-64 bg-white shadow-lg dark:bg-gray-900">
              <div className="border-b border-gray-200 p-4 dark:border-gray-800">
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
                      {BRAND_DOMAIN}
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
      />
    </>
  )
}
