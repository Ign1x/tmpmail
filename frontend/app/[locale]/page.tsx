"use client"

import { useEffect, useState } from "react"
import AppShell from "@/components/app-shell"
import EmptyState from "@/components/empty-state"
import FeatureCards from "@/components/feature-cards"
import AccountInfoBanner from "@/components/account-info-banner"
import MessageList from "@/components/message-list"
import MessageDetail from "@/components/message-detail"
import { useAuth } from "@/contexts/auth-context"
import type { Domain, Message } from "@/types"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import { useTranslations } from "next-intl"
import { CheckCircle, AlertCircle } from "lucide-react"
import { fetchDomainsFromProvider, getServiceStatus, type ServiceStatusResponse } from "@/lib/api"
import { DEFAULT_DOMAIN, DEFAULT_PROVIDER_ID } from "@/lib/provider-config"

function generateRandomString(length: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const charsLength = chars.length

  if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
    const array = new Uint32Array(length)
    window.crypto.getRandomValues(array)
    return Array.from(array, (value) => chars[value % charsLength]).join("")
  }

  let result = ""
  for (let i = 0; i < length; i++) {
    const index = Math.floor(Math.random() * charsLength)
    result += chars[index]
  }
  return result
}

function MainContent() {
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const { isAuthenticated, currentAccount, register } = useAuth()
  const [refreshKey, setRefreshKey] = useState(0)
  const { toast } = useHeroUIToast()
  const [isCreatingAccount, setIsCreatingAccount] = useState(false)
  const [showAccountBanner, setShowAccountBanner] = useState(false)
  const [createdAccountInfo, setCreatedAccountInfo] = useState<{ email: string; password: string } | null>(null)
  const [availableDomains, setAvailableDomains] = useState<Domain[]>([])
  const [serviceStatus, setServiceStatus] = useState<ServiceStatusResponse | null>(null)
  const [isOverviewLoading, setIsOverviewLoading] = useState(true)
  const t = useTranslations("mainPage")
  const primaryDomain = availableDomains[0]?.domain || DEFAULT_DOMAIN || null

  useEffect(() => {
    let active = true

    const loadOverview = async () => {
      setIsOverviewLoading(true)

      const [domainsResult, statusResult] = await Promise.allSettled([
        fetchDomainsFromProvider(DEFAULT_PROVIDER_ID),
        getServiceStatus(DEFAULT_PROVIDER_ID),
      ])

      if (!active) {
        return
      }

      if (domainsResult.status === "fulfilled") {
        setAvailableDomains(domainsResult.value)
      } else {
        setAvailableDomains([])
      }

      if (statusResult.status === "fulfilled") {
        setServiceStatus(statusResult.value)
      } else {
        setServiceStatus({ status: "offline" })
      }

      setIsOverviewLoading(false)
    }

    void loadOverview()

    return () => {
      active = false
    }
  }, [])

  const handleQuickCreate = async () => {
    if (isCreatingAccount) return
    setIsCreatingAccount(true)

    const maxAttempts = 5
    let domain = availableDomains[0]?.domain || DEFAULT_DOMAIN || ""

    try {
      if (availableDomains.length === 0) {
        const nextDomains = await fetchDomainsFromProvider(DEFAULT_PROVIDER_ID)
        setAvailableDomains(nextDomains)
        if (nextDomains[0]?.domain) {
          domain = nextDomains[0].domain
        }
      }
    } catch (error) {
      console.warn("加载可用域名失败:", error)
    }

    if (!domain) {
      toast({
        title: t("domainUnavailable"),
        description: t("domainUnavailableDesc"),
        color: "warning",
        variant: "flat",
        icon: <AlertCircle size={16} />,
      })
      setIsCreatingAccount(false)
      return
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const username = generateRandomString(10)
      const password = generateRandomString(12)
      const email = `${username}@${domain}`

      try {
        await register(email, password, 0)

        toast({
          title: t("tempMailCreated"),
          description: t("checkBanner"),
          color: "success",
          variant: "flat",
          icon: <CheckCircle size={16} />,
        })

        setCreatedAccountInfo({ email, password })
        setShowAccountBanner(true)
        setIsCreatingAccount(false)
        return
      } catch (error: any) {
        const message = error?.message || ""
        const isAddressTaken =
          message.includes("该邮箱地址已被使用") ||
          message.includes("Email address already exists") ||
          message.includes("already used") ||
          message.includes("already exists")

        if (isAddressTaken && attempt < maxAttempts - 1) {
          continue
        }

        console.error("一键创建临时邮箱失败:", error)
        toast({
          title: t("createFailed"),
          description: message || t("createFailedDesc"),
          color: "danger",
          variant: "flat",
          icon: <AlertCircle size={16} />,
        })
        break
      }
    }

    setIsCreatingAccount(false)
  }

  const handleDeleteMessageInDetail = (messageId: string) => {
    setSelectedMessage(null)
    toast({
      title: t("messageDeleted"),
      description: t("messageDeletedDesc", { id: messageId }),
      color: "success",
      variant: "flat",
      icon: <CheckCircle size={16} />,
    })
  }

  return (
    <AppShell
      activeItem="inbox"
      autoOpenUpdateNotice={true}
      onActivateInbox={() => setSelectedMessage(null)}
      onRefreshInbox={() => setRefreshKey((prev) => prev + 1)}
      banner={
        showAccountBanner && createdAccountInfo ? (
          <AccountInfoBanner
            email={createdAccountInfo.email}
            password={createdAccountInfo.password}
            onClose={() => {
              setShowAccountBanner(false)
              setCreatedAccountInfo(null)
            }}
          />
        ) : undefined
      }
    >
      <div className="flex h-full flex-col">
        <div className="flex-1">
          {isAuthenticated && currentAccount ? (
            selectedMessage ? (
              <MessageDetail
                message={selectedMessage}
                onBack={() => setSelectedMessage(null)}
                onDelete={handleDeleteMessageInDetail}
              />
            ) : (
              <MessageList
                onSelectMessage={setSelectedMessage}
                refreshKey={refreshKey}
              />
            )
          ) : (
            <EmptyState
              onCreateAccount={handleQuickCreate}
              isAuthenticated={isAuthenticated}
              isCreating={isCreatingAccount}
              primaryDomain={primaryDomain}
              availableDomainCount={availableDomains.length}
              domainPreview={availableDomains.slice(0, 4).map((domain) => domain.domain)}
              serviceStatus={serviceStatus}
              isOverviewLoading={isOverviewLoading}
            />
          )}
        </div>
        {(!isAuthenticated || !currentAccount) && <FeatureCards />}
      </div>
    </AppShell>
  )
}

export default function Home() {
  return <MainContent />
}
