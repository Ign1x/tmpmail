"use client"

import { useEffect, useState } from "react"
import { Button } from "@heroui/button"
import { Card, CardBody } from "@heroui/card"
import { Input } from "@heroui/input"
import {
  ArrowLeft,
  Check,
  Copy,
  Globe2,
  KeyRound,
  LockKeyhole,
  LogOut,
  RefreshCw,
  RotateCw,
  ShieldCheck,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "@/i18n/navigation"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import {
  type AdminMetricsResponse,
  createManagedDomain,
  fetchManagedDomains,
  getAdminAccessKey,
  getAdminAuditLogs,
  getAdminMetrics,
  getAdminStatus,
  getManagedDomainRecords,
  loginAdmin,
  regenerateAdminAccessKey,
  runAdminCleanup,
  setupAdminPassword,
  updateAdminPassword,
  verifyManagedDomain,
  type AdminStatus,
} from "@/lib/api"
import type { Domain, DomainDnsRecord } from "@/types"
import { DEFAULT_PROVIDER_ID, DEFAULT_PROVIDER_NAME } from "@/lib/provider-config"

const ADMIN_SESSION_STORAGE_KEY = "tmpmail-admin-session"

interface DomainManagementPageProps {
  entryPath: string
}

function sortManagedDomains(domains: Domain[]): Domain[] {
  return [...domains].sort((left, right) => {
    const leftPending = left.status !== "active"
    const rightPending = right.status !== "active"

    if (leftPending !== rightPending) {
      return leftPending ? -1 : 1
    }

    return left.domain.localeCompare(right.domain)
  })
}

function getErrorDescription(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

export default function DomainManagementPage({ entryPath }: DomainManagementPageProps) {
  const { toast } = useHeroUIToast()
  const router = useRouter()
  const ta = useTranslations("admin")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const locale = useLocale()

  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [sessionToken, setSessionToken] = useState("")
  const [adminApiKey, setAdminApiKey] = useState("")
  const [setupPassword, setSetupPassword] = useState("")
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [nextPassword, setNextPassword] = useState("")
  const [managedDomainInput, setManagedDomainInput] = useState("")
  const [managedDomains, setManagedDomains] = useState<Domain[]>([])
  const [managedDomainsLoading, setManagedDomainsLoading] = useState(false)
  const [managedDomainsError, setManagedDomainsError] = useState<string | null>(null)
  const [isCreatingDomain, setIsCreatingDomain] = useState(false)
  const [expandedDomainIds, setExpandedDomainIds] = useState<Record<string, boolean>>({})
  const [recordsLoadingById, setRecordsLoadingById] = useState<Record<string, boolean>>({})
  const [recordsByDomainId, setRecordsByDomainId] = useState<Record<string, DomainDnsRecord[]>>(
    {},
  )
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(null)
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false)
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false)
  const [isRefreshingKey, setIsRefreshingKey] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [adminMetrics, setAdminMetrics] = useState<AdminMetricsResponse | null>(null)
  const [adminAuditLogs, setAdminAuditLogs] = useState<string[]>([])
  const [adminOpsError, setAdminOpsError] = useState<string | null>(null)
  const [isLoadingOps, setIsLoadingOps] = useState(false)
  const [isRunningCleanup, setIsRunningCleanup] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)

  const hasAdminSession = sessionToken.trim().length > 0
  const needsSetup = !status?.isPasswordConfigured

  const resetManagedDomainState = () => {
    setManagedDomains([])
    setManagedDomainsError(null)
    setExpandedDomainIds({})
    setRecordsByDomainId({})
    setRecordsLoadingById({})
    setVerifyingDomainId(null)
  }

  const resetAdminOpsState = () => {
    setAdminMetrics(null)
    setAdminAuditLogs([])
    setAdminOpsError(null)
  }

  const clearAdminSession = (shouldToast = false) => {
    try {
      sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
    } catch {}

    setSessionToken("")
    setAdminApiKey("")
    setLoginPassword("")
    setCurrentPassword("")
    setNextPassword("")
    resetManagedDomainState()
    resetAdminOpsState()

    if (shouldToast) {
      toast({
        title: ta("sessionLoggedOut"),
        color: "default",
        variant: "flat",
      })
    }
  }

  const loadManagedDomains = async (silent = false, tokenOverride = sessionToken) => {
    const effectiveToken = tokenOverride.trim()
    if (!effectiveToken) {
      resetManagedDomainState()
      return
    }

    setManagedDomainsLoading(true)

    try {
      const domains = await fetchManagedDomains(DEFAULT_PROVIDER_ID, effectiveToken)
      setManagedDomains(sortManagedDomains(domains))
      setManagedDomainsError(null)

      if (!silent) {
        toast({
          title: ts("domainsLoaded"),
          description: ts("domainsLoadedDesc", { count: domains.length }),
          color: "success",
          variant: "flat",
        })
      }
    } catch (error) {
      const description = getErrorDescription(error, ts("managedDomainsLoadFailed"))
      setManagedDomains([])
      setManagedDomainsError(description)

      if (!silent) {
        toast({
          title: ts("managedDomainsLoadFailed"),
          description,
          color: "danger",
          variant: "flat",
        })
      }
    } finally {
      setManagedDomainsLoading(false)
    }
  }

  const loadAdminOpsData = async (silent = false, tokenOverride = sessionToken) => {
    const effectiveToken = tokenOverride.trim()
    if (!effectiveToken) {
      resetAdminOpsState()
      return
    }

    setIsLoadingOps(true)

    try {
      const [metricsResponse, auditResponse] = await Promise.all([
        getAdminMetrics(effectiveToken, DEFAULT_PROVIDER_ID),
        getAdminAuditLogs(effectiveToken, DEFAULT_PROVIDER_ID, 40),
      ])
      setAdminMetrics(metricsResponse)
      setAdminAuditLogs(auditResponse.entries)
      setAdminOpsError(null)

      if (!silent) {
        toast({
          title: ta("opsLoaded"),
          color: "success",
          variant: "flat",
        })
      }
    } catch (error) {
      setAdminOpsError(getErrorDescription(error, ta("opsLoadFailedDescription")))

      if (!silent) {
        toast({
          title: ta("opsLoadFailed"),
          description: getErrorDescription(error, ta("opsLoadFailedDescription")),
          color: "danger",
          variant: "flat",
        })
      }
    } finally {
      setIsLoadingOps(false)
    }
  }

  const restoreAdminSession = async (token: string, silent = false) => {
    const trimmedToken = token.trim()
    if (!trimmedToken) {
      clearAdminSession()
      return false
    }

    try {
      const access = await getAdminAccessKey(trimmedToken, DEFAULT_PROVIDER_ID)
      setSessionToken(trimmedToken)
      setAdminApiKey(access.apiKey)
      setStatus((currentStatus) =>
        currentStatus
          ? { ...currentStatus, hasGeneratedApiKey: true }
          : currentStatus,
      )
      try {
        sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, trimmedToken)
      } catch {}
      await Promise.all([
        loadManagedDomains(true, trimmedToken),
        loadAdminOpsData(true, trimmedToken),
      ])

      if (!silent) {
        toast({
          title: ta("sessionReady"),
          color: "success",
          variant: "flat",
        })
      }

      return true
    } catch (error) {
      clearAdminSession()

      if (!silent) {
        toast({
          title: ta("sessionRestoreFailed"),
          description: getErrorDescription(error, ta("sessionRestoreFailed")),
          color: "danger",
          variant: "flat",
        })
      }

      return false
    }
  }

  useEffect(() => {
    const bootstrap = async () => {
      setIsBootstrapping(true)

      try {
        const nextStatus = await getAdminStatus(DEFAULT_PROVIDER_ID)
        setStatus(nextStatus)

        if (typeof window !== "undefined" && nextStatus.isPasswordConfigured) {
          const storedToken = sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY)?.trim() || ""
          if (storedToken) {
            await restoreAdminSession(storedToken, true)
          }
        }
      } catch (error) {
        toast({
          title: ta("statusLoadFailed"),
          description: getErrorDescription(error, ta("statusLoadFailedDesc")),
          color: "danger",
          variant: "flat",
        })
      } finally {
        setIsBootstrapping(false)
      }
    }

    void bootstrap()
  }, [])

  const handleSetupAdmin = async () => {
    if (setupPassword.trim().length < 8) {
      toast({
        title: ta("passwordTooShort"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (setupPassword !== setupPasswordConfirm) {
      toast({
        title: ta("passwordMismatch"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    setIsSubmittingSetup(true)

    try {
      const response = await setupAdminPassword(setupPassword, DEFAULT_PROVIDER_ID)
      try {
        sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, response.sessionToken)
      } catch {}

      setStatus({
        isPasswordConfigured: true,
        hasGeneratedApiKey: true,
      })
      setSessionToken(response.sessionToken)
      setAdminApiKey(response.apiKey)
      setSetupPassword("")
      setSetupPasswordConfirm("")
      await Promise.all([
        loadManagedDomains(true, response.sessionToken),
        loadAdminOpsData(true, response.sessionToken),
      ])

      toast({
        title: ta("setupSuccess"),
        description: ta("setupSuccessDescription"),
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("setupFailed"),
        description: getErrorDescription(error, ta("setupFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsSubmittingSetup(false)
    }
  }

  const handleLoginAdmin = async () => {
    if (!loginPassword.trim()) {
      toast({
        title: ta("loginPasswordRequired"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    setIsSubmittingLogin(true)

    try {
      const response = await loginAdmin(loginPassword, DEFAULT_PROVIDER_ID)
      setLoginPassword("")
      await restoreAdminSession(response.sessionToken)
    } catch (error) {
      toast({
        title: ta("loginFailed"),
        description: getErrorDescription(error, ta("loginFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsSubmittingLogin(false)
    }
  }

  const handleCopyAdminKey = async () => {
    if (!adminApiKey.trim()) {
      return
    }

    try {
      await navigator.clipboard.writeText(adminApiKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 1600)
      toast({
        title: ta("keyCopied"),
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: tc("copyFailed"),
        description: tc("clipboardError"),
        color: "danger",
        variant: "flat",
      })
    }
  }

  const handleRegenerateKey = async () => {
    if (!hasAdminSession) {
      return
    }

    setIsRefreshingKey(true)

    try {
      const response = await regenerateAdminAccessKey(sessionToken, DEFAULT_PROVIDER_ID)
      setAdminApiKey(response.apiKey)
      setStatus((currentStatus) =>
        currentStatus
          ? { ...currentStatus, hasGeneratedApiKey: true }
          : currentStatus,
      )
      toast({
        title: ta("keyRegenerated"),
        description: ta("keyRegeneratedDescription"),
        color: "success",
        variant: "flat",
      })
      await loadAdminOpsData(true)
    } catch (error) {
      toast({
        title: ta("keyRegenerateFailed"),
        description: getErrorDescription(error, ta("keyRegenerateFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsRefreshingKey(false)
    }
  }

  const handleUpdatePassword = async () => {
    if (!currentPassword.trim() || !nextPassword.trim()) {
      toast({
        title: ta("changePasswordRequired"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (nextPassword.trim().length < 8) {
      toast({
        title: ta("passwordTooShort"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    setIsUpdatingPassword(true)

    try {
      await updateAdminPassword(
        sessionToken,
        currentPassword,
        nextPassword,
        DEFAULT_PROVIDER_ID,
      )
      setCurrentPassword("")
      setNextPassword("")
      toast({
        title: ta("passwordChanged"),
        description: ta("passwordChangedDescription"),
        color: "success",
        variant: "flat",
      })
      await loadAdminOpsData(true)
    } catch (error) {
      toast({
        title: ta("passwordChangeFailed"),
        description: getErrorDescription(error, ta("passwordChangeFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  const handleCreateDomain = async () => {
    if (!hasAdminSession) {
      toast({ title: ta("loginFirst"), color: "warning", variant: "flat" })
      return
    }

    if (!managedDomainInput.trim()) {
      toast({ title: ts("domainInputRequired"), color: "warning", variant: "flat" })
      return
    }

    setIsCreatingDomain(true)

    try {
      const createdDomain = await createManagedDomain(
        managedDomainInput.trim(),
        DEFAULT_PROVIDER_ID,
        sessionToken,
      )

      setManagedDomains((currentDomains) =>
        sortManagedDomains([
          createdDomain,
          ...currentDomains.filter((domain) => domain.id !== createdDomain.id),
        ]),
      )
      setExpandedDomainIds((currentState) => ({
        ...currentState,
        [createdDomain.id]: true,
      }))
      setManagedDomainInput("")
      setManagedDomainsError(null)

      try {
        const dnsRecords = await getManagedDomainRecords(
          createdDomain.id,
          DEFAULT_PROVIDER_ID,
          sessionToken,
        )
        setRecordsByDomainId((currentRecords) => ({
          ...currentRecords,
          [createdDomain.id]: dnsRecords,
        }))
        toast({
          title: ts("domainAdded"),
          description: ts("dnsRecordsReady"),
          color: "success",
          variant: "flat",
        })
      } catch (error) {
        toast({
          title: ts("domainAdded"),
          description: getErrorDescription(error, ts("dnsRecordsPartialLoadFailed")),
          color: "warning",
          variant: "flat",
        })
      }
      await loadAdminOpsData(true)
    } catch (error) {
      toast({
        title: ts("domainAddFailed"),
        description: getErrorDescription(error, ts("domainAddFailed")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsCreatingDomain(false)
    }
  }

  const handleToggleDomainRecords = async (domainId: string) => {
    if (expandedDomainIds[domainId]) {
      setExpandedDomainIds((currentState) => ({
        ...currentState,
        [domainId]: false,
      }))
      return
    }

    if (!recordsByDomainId[domainId]) {
      setRecordsLoadingById((currentState) => ({
        ...currentState,
        [domainId]: true,
      }))

      try {
        const dnsRecords = await getManagedDomainRecords(
          domainId,
          DEFAULT_PROVIDER_ID,
          sessionToken,
        )
        setRecordsByDomainId((currentRecords) => ({
          ...currentRecords,
          [domainId]: dnsRecords,
        }))
      } catch (error) {
        toast({
          title: ts("dnsRecordsLoadFailed"),
          description: getErrorDescription(error, ts("dnsRecordsLoadFailed")),
          color: "danger",
          variant: "flat",
        })
        return
      } finally {
        setRecordsLoadingById((currentState) => ({
          ...currentState,
          [domainId]: false,
        }))
      }
    }

    setExpandedDomainIds((currentState) => ({
      ...currentState,
      [domainId]: true,
    }))
  }

  const handleVerifyDomain = async (domainId: string) => {
    setVerifyingDomainId(domainId)

    try {
      const updatedDomain = await verifyManagedDomain(
        domainId,
        DEFAULT_PROVIDER_ID,
        sessionToken,
      )

      setManagedDomains((currentDomains) =>
        sortManagedDomains(
          currentDomains.map((domain) =>
            domain.id === domainId ? { ...domain, ...updatedDomain } : domain,
          ),
        ),
      )

      toast({
        title: updatedDomain.isVerified ? ts("domainVerifySuccess") : ts("domainVerifyPending"),
        description: updatedDomain.verificationError || ts("domainVerifyPendingDesc"),
        color: updatedDomain.isVerified ? "success" : "warning",
        variant: "flat",
      })
      await loadAdminOpsData(true)
    } catch (error) {
      toast({
        title: ts("domainVerifyFailed"),
        description: getErrorDescription(error, ts("domainVerifyFailedDesc")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setVerifyingDomainId(null)
    }
  }

  const getDomainStatusLabel = (domain: Domain) => {
    if (domain.status === "active" || domain.isVerified) {
      return ts("domainStatusActive")
    }

    if (domain.status === "pending_verification") {
      return ts("domainStatusPending")
    }

    return ts("domainStatusUnknown")
  }

  const getDomainStatusClassName = (domain: Domain) => {
    if (domain.status === "active" || domain.isVerified) {
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    }

    if (domain.status === "pending_verification") {
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    }

    return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
  }

  const formatTimestamp = (value?: string) => {
    if (!value) {
      return ta("opsTimestampEmpty")
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return ta("opsTimestampEmpty")
    }

    return parsed.toLocaleString(locale === "zh" ? "zh-CN" : "en-US")
  }

  const formatMetricValue = (value: number) =>
    new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US").format(value)

  const handleRunCleanup = async () => {
    if (!hasAdminSession) {
      return
    }

    setIsRunningCleanup(true)

    try {
      const response = await runAdminCleanup(sessionToken, DEFAULT_PROVIDER_ID)
      await Promise.all([loadAdminOpsData(true), loadManagedDomains(true)])
      toast({
        title: ta("cleanupCompleted"),
        description: ta("cleanupCompletedDescription", {
          accounts: response.deletedAccounts,
          messages: response.deletedMessages,
          domains: response.deletedDomains,
        }),
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("cleanupFailed"),
        description: getErrorDescription(error, ta("cleanupFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsRunningCleanup(false)
    }
  }

  const metricCards = adminMetrics
    ? [
        { label: ta("opsDomains"), value: adminMetrics.totalDomains },
        { label: ta("opsActiveDomains"), value: adminMetrics.activeDomains },
        { label: ta("opsPendingDomains"), value: adminMetrics.pendingDomains },
        { label: ta("opsAccounts"), value: adminMetrics.totalAccounts },
        { label: ta("opsActiveAccounts"), value: adminMetrics.activeAccounts },
        { label: ta("opsMessages"), value: adminMetrics.totalMessages },
        { label: ta("opsActiveMessages"), value: adminMetrics.activeMessages },
        { label: ta("opsDeletedMessages"), value: adminMetrics.deletedMessages },
        { label: ta("opsAuditLogs"), value: adminMetrics.auditLogsTotal },
        { label: ta("opsImportedMessages"), value: adminMetrics.importedMessagesTotal },
        {
          label: ta("opsDeletedUpstreamMessages"),
          value: adminMetrics.deletedUpstreamMessagesTotal,
        },
        { label: ta("opsRealtime"), value: adminMetrics.realtimeEventsTotal },
        { label: ta("opsSseConnections"), value: adminMetrics.sseConnectionsActive },
        { label: ta("opsSyncRuns"), value: adminMetrics.inbucketSyncRunsTotal },
        { label: ta("opsSyncFailures"), value: adminMetrics.inbucketSyncFailuresTotal },
        {
          label: ta("opsVerificationRuns"),
          value: adminMetrics.domainVerificationRunsTotal,
        },
        {
          label: ta("opsVerificationFailures"),
          value: adminMetrics.domainVerificationFailuresTotal,
        },
        { label: ta("opsCleanupRuns"), value: adminMetrics.cleanupRunsTotal },
        {
          label: ta("opsCleanupDeletedAccounts"),
          value: adminMetrics.cleanupDeletedAccountsTotal,
        },
        {
          label: ta("opsCleanupDeletedMessages"),
          value: adminMetrics.cleanupDeletedMessagesTotal,
        },
        {
          label: ta("opsCleanupDeletedDomains"),
          value: adminMetrics.cleanupDeletedDomainsTotal,
        },
      ]
    : []

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),transparent_30%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-6 text-gray-900 dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-gray-100 md:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/70 dark:shadow-none md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <ShieldCheck size={14} />
                {ta("title")}
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-gray-950 dark:text-white md:text-4xl">
                  {ta("headline")}
                </h1>
                <p className="max-w-3xl text-sm leading-7 text-gray-600 dark:text-gray-300">
                  {ta("description", { provider: DEFAULT_PROVIDER_NAME })}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="rounded-full bg-white/80 px-3 py-1 shadow-sm dark:bg-slate-900/70">
                  {ta("entryHint", { path: entryPath })}
                </span>
                <span className="rounded-full bg-white/80 px-3 py-1 shadow-sm dark:bg-slate-900/70">
                  {ta("adminScope")}
                </span>
              </div>
            </div>

            <Button
              variant="flat"
              className="rounded-full bg-white/80 px-4 text-slate-700 shadow-sm backdrop-blur dark:bg-slate-900/70 dark:text-slate-200"
              startContent={<ArrowLeft size={16} />}
              onPress={() => router.push("/")}
            >
              {tc("back")}
            </Button>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <Card className="border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
            <CardBody className="gap-5 p-6">
              <div className="space-y-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-950 dark:text-white">
                  <LockKeyhole size={18} />
                  {ta("accessTitle")}
                </h2>
                <p className="text-sm leading-7 text-gray-600 dark:text-gray-300">
                  {needsSetup ? ta("setupDescription") : ta("loginDescription")}
                </p>
              </div>

              {isBootstrapping ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  {ta("loadingStatus")}
                </div>
              ) : needsSetup ? (
                <div className="space-y-4">
                  <Input
                    label={ta("setupPasswordLabel")}
                    placeholder={ta("setupPasswordPlaceholder")}
                    type="password"
                    value={setupPassword}
                    onValueChange={setSetupPassword}
                    variant="bordered"
                    autoComplete="new-password"
                  />
                  <Input
                    label={ta("confirmPasswordLabel")}
                    placeholder={ta("confirmPasswordPlaceholder")}
                    type="password"
                    value={setupPasswordConfirm}
                    onValueChange={setSetupPasswordConfirm}
                    variant="bordered"
                    autoComplete="new-password"
                  />
                  <Button
                    color="primary"
                    className="h-11 rounded-xl bg-sky-600 text-white hover:bg-sky-700"
                    onPress={handleSetupAdmin}
                    isLoading={isSubmittingSetup}
                  >
                    {ta("setupSubmit")}
                  </Button>
                </div>
              ) : hasAdminSession ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      {ta("sessionReady")}
                    </span>
                    <Button
                      size="sm"
                      variant="flat"
                      color="default"
                      startContent={<LogOut size={14} />}
                      onPress={() => clearAdminSession(true)}
                    >
                      {ta("logout")}
                    </Button>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-slate-100 dark:border-slate-800">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{ta("generatedKeyTitle")}</div>
                        <div className="text-xs text-slate-400">{ta("generatedKeyDescription")}</div>
                      </div>
                      <KeyRound size={16} className="text-sky-300" />
                    </div>
                    <code className="block break-all font-mono text-[13px] leading-6 text-slate-100">
                      {adminApiKey || ta("keyLoading")}
                    </code>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      color="primary"
                      className="rounded-full bg-sky-600 text-white hover:bg-sky-700"
                      startContent={copiedKey ? <Check size={16} /> : <Copy size={16} />}
                      onPress={handleCopyAdminKey}
                      isDisabled={!adminApiKey}
                    >
                      {copiedKey ? ta("keyCopiedAction") : ta("copyKey")}
                    </Button>
                    <Button
                      variant="bordered"
                      className="rounded-full"
                      startContent={<RotateCw size={16} />}
                      onPress={handleRegenerateKey}
                      isLoading={isRefreshingKey}
                    >
                      {ta("regenerateKey")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <Input
                    label={ta("loginPasswordLabel")}
                    placeholder={ta("loginPasswordPlaceholder")}
                    type="password"
                    value={loginPassword}
                    onValueChange={setLoginPassword}
                    variant="bordered"
                    autoComplete="current-password"
                  />
                  <Button
                    color="primary"
                    className="h-11 rounded-xl bg-sky-600 text-white hover:bg-sky-700"
                    onPress={handleLoginAdmin}
                    isLoading={isSubmittingLogin}
                  >
                    {ta("loginSubmit")}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
            <CardBody className="gap-5 p-6">
              <div className="space-y-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-950 dark:text-white">
                  <KeyRound size={18} />
                  {ta("passwordSectionTitle")}
                </h2>
                <p className="text-sm leading-7 text-gray-600 dark:text-gray-300">
                  {ta("passwordSectionDescription")}
                </p>
              </div>

              {hasAdminSession ? (
                <div className="space-y-4">
                  <Input
                    label={ta("currentPasswordLabel")}
                    placeholder={ta("currentPasswordPlaceholder")}
                    type="password"
                    value={currentPassword}
                    onValueChange={setCurrentPassword}
                    variant="bordered"
                    autoComplete="current-password"
                  />
                  <Input
                    label={ta("newPasswordLabel")}
                    placeholder={ta("newPasswordPlaceholder")}
                    type="password"
                    value={nextPassword}
                    onValueChange={setNextPassword}
                    variant="bordered"
                    autoComplete="new-password"
                  />
                  <Button
                    variant="bordered"
                    className="rounded-xl"
                    onPress={handleUpdatePassword}
                    isLoading={isUpdatingPassword}
                  >
                    {ta("changePassword")}
                  </Button>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  {needsSetup ? ta("setupFirstHint") : ta("loginFirstHint")}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/60 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-gray-950 dark:text-white">
                {ta("inventoryTitle")}
              </h2>
              <p className="text-sm leading-7 text-gray-600 dark:text-gray-300">
                {ta("inventoryDescription", { provider: DEFAULT_PROVIDER_NAME })}
              </p>
            </div>
            <Button
              size="sm"
              variant="flat"
              startContent={<RefreshCw size={16} />}
              onPress={() => void loadManagedDomains(false)}
              isLoading={managedDomainsLoading}
              isDisabled={!hasAdminSession}
            >
              {ts("refreshDomains")}
            </Button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              label={ts("domainInputLabel")}
              placeholder={ts("domainInputPlaceholder")}
              description={ts("domainInputDescription")}
              value={managedDomainInput}
              onValueChange={setManagedDomainInput}
              variant="bordered"
              isDisabled={!hasAdminSession || isCreatingDomain}
            />
            <Button
              color="primary"
              className="md:self-start"
              startContent={<Globe2 size={16} />}
              onPress={handleCreateDomain}
              isLoading={isCreatingDomain}
              isDisabled={!hasAdminSession}
            >
              {ts("addDomain")}
            </Button>
          </div>

          {!hasAdminSession && !isBootstrapping && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              {ta("loginFirst")}
            </div>
          )}

          {managedDomainsError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {managedDomainsError}
            </div>
          )}

          {managedDomainsLoading && hasAdminSession && (
            <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">
              {ts("loadingDomains")}
            </div>
          )}

          {!managedDomainsLoading &&
            hasAdminSession &&
            managedDomains.length === 0 &&
            !managedDomainsError && (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white/80 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-black/10 dark:text-gray-300">
                <div>{ts("noManagedDomains")}</div>
                <div className="mt-1">{ta("emptyHint")}</div>
              </div>
            )}

          {managedDomains.length > 0 && (
            <div className="mt-5 space-y-3">
              {managedDomains.map((domain) => (
                <Card
                  key={domain.id}
                  className="border border-amber-200/70 bg-white/90 dark:border-amber-900/60 dark:bg-slate-950/40"
                >
                  <CardBody className="space-y-4 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-base text-gray-900 dark:text-gray-100">
                            {domain.domain}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getDomainStatusClassName(domain)}`}
                          >
                            {getDomainStatusLabel(domain)}
                          </span>
                        </div>
                        {domain.verificationError && (
                          <div className="text-sm text-red-600 dark:text-red-300">
                            {ts("lastVerificationError")}: {domain.verificationError}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="flat"
                          onPress={() => void handleToggleDomainRecords(domain.id)}
                          isLoading={!!recordsLoadingById[domain.id]}
                        >
                          {expandedDomainIds[domain.id]
                            ? ts("hideDnsRecords")
                            : ts("showDnsRecords")}
                        </Button>
                        <Button
                          size="sm"
                          color={domain.isVerified ? "success" : "secondary"}
                          variant="flat"
                          onPress={() => void handleVerifyDomain(domain.id)}
                          isLoading={verifyingDomainId === domain.id}
                        >
                          {domain.isVerified ? ts("recheckDomain") : ts("verifyDomain")}
                        </Button>
                      </div>
                    </div>

                    {expandedDomainIds[domain.id] && recordsByDomainId[domain.id] && (
                      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
                        <div className="mb-3">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {ts("dnsRecordsTitle")}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {ts("dnsRecordsHint")}
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          {recordsByDomainId[domain.id].map((record) => (
                            <div
                              key={`${domain.id}-${record.kind}-${record.name}`}
                              className="rounded-lg border border-white/70 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/80"
                            >
                              <div className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">
                                {record.kind}
                              </div>
                              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                {ts("recordHost")}
                              </div>
                              <div className="break-all font-mono text-sm text-gray-900 dark:text-gray-100">
                                {record.name}
                              </div>
                              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                {ts("recordValue")}
                              </div>
                              <div className="break-all font-mono text-sm text-gray-900 dark:text-gray-100">
                                {record.value}
                              </div>
                              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                                {ts("ttlLabel")}: {record.ttl}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <Card className="border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
            <CardBody className="gap-5 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-gray-950 dark:text-white">
                    {ta("opsTitle")}
                  </h2>
                  <p className="text-sm leading-7 text-gray-600 dark:text-gray-300">
                    {ta("opsDescription")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<RefreshCw size={16} />}
                    onPress={() => void loadAdminOpsData(false)}
                    isLoading={isLoadingOps}
                    isDisabled={!hasAdminSession}
                  >
                    {ta("opsRefresh")}
                  </Button>
                  <Button
                    size="sm"
                    color="primary"
                    className="bg-sky-600 text-white hover:bg-sky-700"
                    startContent={<RotateCw size={16} />}
                    onPress={handleRunCleanup}
                    isLoading={isRunningCleanup}
                    isDisabled={!hasAdminSession}
                  >
                    {ta("runCleanup")}
                  </Button>
                </div>
              </div>

              {!hasAdminSession ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  {ta("loginFirst")}
                </div>
              ) : isLoadingOps && !adminMetrics ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  {ta("opsLoading")}
                </div>
              ) : (
                <div className="space-y-5">
                  {adminOpsError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                      <div className="font-medium">{ta("opsLoadFailed")}</div>
                      <div className="mt-1">{adminOpsError}</div>
                    </div>
                  )}

                  {adminMetrics && (
                    <>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {metricCards.map((item) => (
                          <div
                            key={item.label}
                            className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/70"
                          >
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                              {item.label}
                            </div>
                            <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                              {formatMetricValue(item.value)}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                            {ta("opsLastInbucketSync")}
                          </div>
                          <div className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                            {formatTimestamp(adminMetrics.lastInbucketSyncAt)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                            {ta("opsLastDomainVerification")}
                          </div>
                          <div className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                            {formatTimestamp(adminMetrics.lastDomainVerificationAt)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                            {ta("opsLastCleanup")}
                          </div>
                          <div className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                            {formatTimestamp(adminMetrics.lastCleanupAt)}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
            <CardBody className="gap-5 p-6">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-gray-950 dark:text-white">
                  {ta("auditTitle")}
                </h2>
                <p className="text-sm leading-7 text-gray-600 dark:text-gray-300">
                  {ta("auditDescription")}
                </p>
              </div>

              {!hasAdminSession ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  {ta("loginFirst")}
                </div>
              ) : adminAuditLogs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  {isLoadingOps ? ta("opsLoading") : ta("auditEmpty")}
                </div>
              ) : (
                <div className="max-h-[42rem] space-y-3 overflow-y-auto pr-1">
                  {adminAuditLogs.map((entry, index) => (
                    <div
                      key={`${index}-${entry}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 font-mono text-xs leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200"
                    >
                      {entry}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </section>
      </div>
    </div>
  )
}
