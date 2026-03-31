"use client"

import { type ReactNode, useEffect, useMemo, useState } from "react"
import { Button } from "@heroui/button"
import { Card, CardBody } from "@heroui/card"
import { Input } from "@heroui/input"
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Globe2,
  KeyRound,
  LogOut,
  ReceiptText,
  RefreshCw,
  RotateCw,
  Server,
  ShieldAlert,
  Trash2,
  Users2,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter } from "@/i18n/navigation"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import {
  type AdminMetricsResponse,
  type AdminSessionInfo,
  type AdminSystemSettings,
  type ConsoleUser,
  createAdminUser,
  createManagedDomain,
  deleteAdminUser,
  deleteManagedDomain,
  fetchAdminUsers,
  fetchManagedDomains,
  fetchServiceStatus,
  getAdminAccessKey,
  getAdminAuditLogs,
  getAdminMetrics,
  getAdminSessionInfo,
  getManagedDomainRecords,
  regenerateAdminAccessKey,
  resetAdminUserPassword,
  runAdminCleanup,
  updateAdminPassword,
  updateAdminSystemSettings,
  updateAdminUser,
  verifyManagedDomain,
} from "@/lib/api"
import {
  clearStoredAdminSession,
  clearStoredRevealedAdminKey,
  getStoredAdminSession,
  getStoredRevealedAdminKey,
  storeRevealedAdminKey,
} from "@/lib/admin-session"
import type { Domain, DomainDnsRecord } from "@/types"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"
import ThemeModeToggle from "@/components/theme-mode-toggle"

const ADMIN_KEY_VISIBLE_MS = 60_000

interface DomainManagementPageProps {
  entryPath: string
  requireSecureTransport: boolean
}

type ConsoleView = "overview" | "domains" | "users" | "security" | "logs"

function isTrustedAdminContext(): boolean {
  if (typeof window === "undefined") {
    return true
  }

  if (window.isSecureContext || window.location.protocol === "https:") {
    return true
  }

  const hostname = window.location.hostname.toLowerCase()
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  )
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Clipboard is unavailable")
  }

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed")
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

function getErrorDescription(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
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

function renderRecordValue(record: DomainDnsRecord) {
  return `${record.name} -> ${record.value}`
}

export default function DomainManagementPage({
  entryPath,
  requireSecureTransport,
}: DomainManagementPageProps) {
  const { toast } = useHeroUIToast()
  const router = useRouter()
  const ta = useTranslations("admin")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const tt = useTranslations("theme")

  const [view, setView] = useState<ConsoleView>("overview")
  const [sessionToken, setSessionToken] = useState("")
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isRedirectingToEntry, setIsRedirectingToEntry] = useState(false)
  const [sessionInfo, setSessionInfo] = useState<AdminSessionInfo | null>(null)
  const [serviceStatus, setServiceStatus] = useState<{
    status: "ready" | "degraded" | "offline"
    storeBackend?: string
  } | null>(null)
  const [managedDomains, setManagedDomains] = useState<Domain[]>([])
  const [managedDomainsLoading, setManagedDomainsLoading] = useState(false)
  const [managedDomainInput, setManagedDomainInput] = useState("")
  const [isCreatingDomain, setIsCreatingDomain] = useState(false)
  const [recordsByDomainId, setRecordsByDomainId] = useState<Record<string, DomainDnsRecord[]>>({})
  const [recordsLoadingById, setRecordsLoadingById] = useState<Record<string, boolean>>({})
  const [expandedDomainIds, setExpandedDomainIds] = useState<Record<string, boolean>>({})
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(null)
  const [deletingDomainId, setDeletingDomainId] = useState<string | null>(null)
  const [adminUsers, setAdminUsers] = useState<ConsoleUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [newUserUsername, setNewUserUsername] = useState("")
  const [newUserPassword, setNewUserPassword] = useState("")
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user")
  const [newUserDomainLimit, setNewUserDomainLimit] = useState("3")
  const [creatingUser, setCreatingUser] = useState(false)
  const [adminMetrics, setAdminMetrics] = useState<AdminMetricsResponse | null>(null)
  const [adminAuditLogs, setAdminAuditLogs] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [isRunningCleanup, setIsRunningCleanup] = useState(false)
  const [adminApiKey, setAdminApiKey] = useState("")
  const [adminKeyHideAt, setAdminKeyHideAt] = useState<number | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedDnsTarget, setCopiedDnsTarget] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [nextPassword, setNextPassword] = useState("")
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [isRefreshingKey, setIsRefreshingKey] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<AdminSystemSettings>({
    systemEnabled: true,
  })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [isSecureAdminContext, setIsSecureAdminContext] = useState(() => !requireSecureTransport)

  const currentUser = sessionInfo?.user ?? null
  const isAdmin = currentUser?.role === "admin"
  const hasAdminSession = sessionToken.trim().length > 0
  const hasVisibleAdminKey = adminApiKey.trim().length > 0
  const canUseSensitiveAdminActions = !requireSecureTransport || isSecureAdminContext
  const usersById = useMemo(
    () => Object.fromEntries(adminUsers.map((user) => [user.id, user])),
    [adminUsers],
  )
  const activeDomainsCount = managedDomains.filter((domain) => domain.isVerified || domain.status === "active").length
  const pendingDomainsCount = managedDomains.length - activeDomainsCount
  const sectionMeta =
    view === "overview"
      ? { title: ta("systemPanelTitle") }
      : view === "domains"
        ? { title: ta("domainPanelTitle") }
        : view === "users"
          ? { title: ta("userPanelTitle") }
          : view === "security"
            ? { title: ta("securityPanelTitle") }
            : { title: ta("logsPanelTitle") }

  useEffect(() => {
    setIsSecureAdminContext(!requireSecureTransport || isTrustedAdminContext())
  }, [requireSecureTransport])

  useEffect(() => {
    if (!hasVisibleAdminKey || !adminKeyHideAt) {
      return
    }

    const remainingMs = adminKeyHideAt - Date.now()
    if (remainingMs <= 0) {
      clearStoredRevealedAdminKey()
      setAdminApiKey("")
      setAdminKeyHideAt(null)
      setCopiedKey(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      clearStoredRevealedAdminKey()
      setAdminApiKey("")
      setAdminKeyHideAt(null)
      setCopiedKey(false)
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [adminApiKey, adminKeyHideAt, hasVisibleAdminKey])

  useEffect(() => {
    const bootstrap = async () => {
      setIsBootstrapping(true)

      const storedToken = getStoredAdminSession()
      const storedKey = getStoredRevealedAdminKey()
      if (storedKey) {
        setAdminApiKey(storedKey.apiKey)
        setAdminKeyHideAt(storedKey.expiresAt)
      }

      if (!storedToken) {
        setIsRedirectingToEntry(true)
        setIsBootstrapping(false)
        router.replace(entryPath)
        return
      }

      if (requireSecureTransport && !isTrustedAdminContext()) {
        clearAdminSession()
        return
      }

      setSessionToken(storedToken)

      try {
        const [session, domains, status] = await Promise.all([
          getAdminSessionInfo(storedToken, DEFAULT_PROVIDER_ID),
          fetchManagedDomains(DEFAULT_PROVIDER_ID, storedToken),
          fetchServiceStatus(DEFAULT_PROVIDER_ID),
        ])

        setSessionInfo(session)
        setSettingsDraft(session.systemSettings)
        setManagedDomains(sortManagedDomains(domains))
        setServiceStatus(status)

        if (session.user.role === "admin") {
          const [users, metrics, logs] = await Promise.all([
            fetchAdminUsers(storedToken, DEFAULT_PROVIDER_ID),
            getAdminMetrics(storedToken, DEFAULT_PROVIDER_ID),
            getAdminAuditLogs(storedToken, DEFAULT_PROVIDER_ID, 60),
          ])
          setAdminUsers(users)
          setAdminMetrics(metrics)
          setAdminAuditLogs(logs.entries)
        } else {
          setAdminUsers([])
          setAdminMetrics(null)
          setAdminAuditLogs([])
        }
      } catch (error) {
        toast({
          title: ta("sessionRestoreFailed"),
          description: getErrorDescription(error, ta("sessionRestoreFailed")),
          color: "danger",
          variant: "flat",
        })
        clearAdminSession()
        return
      } finally {
        setIsBootstrapping(false)
      }
    }

    void bootstrap()
  }, [entryPath, requireSecureTransport])

  const clearAdminSession = () => {
    clearStoredAdminSession()
    clearStoredRevealedAdminKey()
    setSessionToken("")
    setSessionInfo(null)
    setIsRedirectingToEntry(true)
    router.replace(entryPath)
  }

  const loadManagedDomains = async (silent = false) => {
    if (!sessionToken.trim()) {
      return
    }

    setManagedDomainsLoading(true)
    try {
      const domains = await fetchManagedDomains(DEFAULT_PROVIDER_ID, sessionToken)
      setManagedDomains(sortManagedDomains(domains))
    } catch (error) {
      if (!silent) {
        toast({
          title: ts("managedDomainsLoadFailed"),
          description: getErrorDescription(error, ts("managedDomainsLoadFailed")),
          color: "danger",
          variant: "flat",
        })
      }
    } finally {
      setManagedDomainsLoading(false)
    }
  }

  const loadUsers = async (silent = false) => {
    if (!sessionToken.trim() || !isAdmin) {
      return
    }

    setUsersLoading(true)
    try {
      setAdminUsers(await fetchAdminUsers(sessionToken, DEFAULT_PROVIDER_ID))
    } catch (error) {
      if (!silent) {
        toast({
          title: ta("userLoadFailed"),
          description: getErrorDescription(error, ta("userLoadFailedDescription")),
          color: "danger",
          variant: "flat",
        })
      }
    } finally {
      setUsersLoading(false)
    }
  }

  const loadOps = async (silent = false) => {
    if (!sessionToken.trim() || !isAdmin) {
      return
    }

    setLogsLoading(true)
    try {
      const [metrics, logs, status] = await Promise.all([
        getAdminMetrics(sessionToken, DEFAULT_PROVIDER_ID),
        getAdminAuditLogs(sessionToken, DEFAULT_PROVIDER_ID, 60),
        fetchServiceStatus(DEFAULT_PROVIDER_ID),
      ])
      setAdminMetrics(metrics)
      setAdminAuditLogs(logs.entries)
      setServiceStatus(status)
    } catch (error) {
      if (!silent) {
        toast({
          title: ta("opsLoadFailed"),
          description: getErrorDescription(error, ta("opsLoadFailedDescription")),
          color: "danger",
          variant: "flat",
        })
      }
    } finally {
      setLogsLoading(false)
    }
  }

  const handleCopyAdminKey = async () => {
    if (!hasVisibleAdminKey) {
      return
    }

    try {
      await copyTextToClipboard(adminApiKey)
      setCopiedKey(true)
      window.setTimeout(() => setCopiedKey(false), 1_500)
      toast({
        title: ta("keyCopied"),
        color: "success",
        variant: "flat",
      })
    } catch {
      toast({
        title: tc("copyFailed"),
        description: tc("clipboardError"),
        color: "danger",
        variant: "flat",
      })
    }
  }

  const handleCopyDnsField = async (value: string, target: string) => {
    try {
      await copyTextToClipboard(value)
      setCopiedDnsTarget(target)
      window.setTimeout(() => setCopiedDnsTarget(""), 1_500)
      toast({
        title: tc("contentCopied"),
        color: "success",
        variant: "flat",
      })
    } catch {
      toast({
        title: tc("copyFailed"),
        description: tc("clipboardError"),
        color: "danger",
        variant: "flat",
      })
    }
  }

  const handleRevealAdminKey = async () => {
    if (!sessionToken.trim()) {
      return
    }

    setIsRefreshingKey(true)
    try {
      const response = await getAdminAccessKey(sessionToken, DEFAULT_PROVIDER_ID)
      const expiresAt = Date.now() + ADMIN_KEY_VISIBLE_MS
      setAdminApiKey(response.apiKey)
      setAdminKeyHideAt(expiresAt)
      storeRevealedAdminKey(response.apiKey, ADMIN_KEY_VISIBLE_MS)
    } catch (error) {
      toast({
        title: ta("keyLoadFailed"),
        description: getErrorDescription(error, ta("keyLoadFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsRefreshingKey(false)
    }
  }

  const handleRegenerateKey = async () => {
    if (!sessionToken.trim()) {
      return
    }

    setIsRefreshingKey(true)
    try {
      const response = await regenerateAdminAccessKey(sessionToken, DEFAULT_PROVIDER_ID)
      const expiresAt = Date.now() + ADMIN_KEY_VISIBLE_MS
      setAdminApiKey(response.apiKey)
      setAdminKeyHideAt(expiresAt)
      storeRevealedAdminKey(response.apiKey, ADMIN_KEY_VISIBLE_MS)
      toast({
        title: ta("keyRegenerated"),
        description: ta("keyRegeneratedDescription"),
        color: "success",
        variant: "flat",
      })
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
    if (!sessionToken.trim()) {
      return
    }

    if (!currentPassword.trim() || !nextPassword.trim()) {
      toast({ title: ta("changePasswordRequired"), color: "warning", variant: "flat" })
      return
    }

    if (nextPassword.trim().length < 6) {
      toast({ title: ta("passwordTooShort"), color: "warning", variant: "flat" })
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
    if (!sessionToken.trim()) {
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
      setManagedDomains((current) =>
        sortManagedDomains([createdDomain, ...current.filter((item) => item.id !== createdDomain.id)]),
      )
      setManagedDomainInput("")
      toast({
        title: ts("domainAdded"),
        description: ts("dnsRecordsReady"),
        color: "success",
        variant: "flat",
      })
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
      setExpandedDomainIds((current) => ({ ...current, [domainId]: false }))
      return
    }

    if (!recordsByDomainId[domainId]) {
      setRecordsLoadingById((current) => ({ ...current, [domainId]: true }))
      try {
        const records = await getManagedDomainRecords(domainId, DEFAULT_PROVIDER_ID, sessionToken)
        setRecordsByDomainId((current) => ({ ...current, [domainId]: records }))
      } catch (error) {
        toast({
          title: ts("dnsRecordsLoadFailed"),
          description: getErrorDescription(error, ts("dnsRecordsLoadFailed")),
          color: "danger",
          variant: "flat",
        })
        return
      } finally {
        setRecordsLoadingById((current) => ({ ...current, [domainId]: false }))
      }
    }

    setExpandedDomainIds((current) => ({ ...current, [domainId]: true }))
  }

  const handleVerifyDomain = async (domainId: string) => {
    setVerifyingDomainId(domainId)
    try {
      const updatedDomain = await verifyManagedDomain(domainId, DEFAULT_PROVIDER_ID, sessionToken)
      setManagedDomains((current) =>
        sortManagedDomains(
          current.map((domain) => (domain.id === domainId ? { ...domain, ...updatedDomain } : domain)),
        ),
      )
      toast({
        title: updatedDomain.isVerified ? ts("domainVerifySuccess") : ts("domainVerifyPending"),
        description: updatedDomain.verificationError || ts("domainVerifyPendingDesc"),
        color: updatedDomain.isVerified ? "success" : "warning",
        variant: "flat",
      })
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

  const handleDeleteDomain = async (domain: Domain) => {
    if (!window.confirm(ts("domainDeleteConfirm", { domain: domain.domain }))) {
      return
    }

    setDeletingDomainId(domain.id)
    try {
      await deleteManagedDomain(domain.id, DEFAULT_PROVIDER_ID, sessionToken)
      setManagedDomains((current) => current.filter((item) => item.id !== domain.id))
      toast({
        title: ts("domainDeleted"),
        description: domain.domain,
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ts("domainDeleteFailed"),
        description: getErrorDescription(error, ts("domainDeleteFailedDesc")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setDeletingDomainId(null)
    }
  }

  const handleCreateUser = async () => {
    if (!sessionToken.trim()) {
      return
    }

    const domainLimit = Number(newUserDomainLimit)
    if (!newUserUsername.trim() || !newUserPassword.trim() || Number.isNaN(domainLimit)) {
      toast({ title: ta("userCreateInvalid"), color: "warning", variant: "flat" })
      return
    }

    setCreatingUser(true)
    try {
      const user = await createAdminUser(
        sessionToken,
        {
          username: newUserUsername.trim(),
          password: newUserPassword,
          role: newUserRole,
          domainLimit,
        },
        DEFAULT_PROVIDER_ID,
      )
      setAdminUsers((current) => [...current, user].sort((a, b) => a.username.localeCompare(b.username)))
      setNewUserUsername("")
      setNewUserPassword("")
      setNewUserRole("user")
      setNewUserDomainLimit("3")
      toast({
        title: ta("userCreated"),
        description: user.username,
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("userCreateFailed"),
        description: getErrorDescription(error, ta("userCreateFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setCreatingUser(false)
    }
  }

  const handlePatchUser = async (user: ConsoleUser, patch: Partial<ConsoleUser>) => {
    if (!sessionToken.trim()) {
      return
    }

    try {
      const updated = await updateAdminUser(
        sessionToken,
        user.id,
        {
          role: patch.role,
          domainLimit: patch.domainLimit,
          isDisabled: patch.isDisabled,
          username: patch.username,
        },
        DEFAULT_PROVIDER_ID,
      )
      setAdminUsers((current) =>
        current
          .map((item) => (item.id === user.id ? updated : item))
          .sort((a, b) => a.username.localeCompare(b.username)),
      )
    } catch (error) {
      toast({
        title: ta("userUpdateFailed"),
        description: getErrorDescription(error, ta("userUpdateFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    }
  }

  const handleDeleteUser = async (user: ConsoleUser) => {
    if (!window.confirm(ta("userDeleteConfirm", { username: user.username }))) {
      return
    }

    try {
      await deleteAdminUser(sessionToken, user.id, DEFAULT_PROVIDER_ID)
      setAdminUsers((current) => current.filter((item) => item.id !== user.id))
      toast({
        title: ta("userDeleted"),
        description: user.username,
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("userDeleteFailed"),
        description: getErrorDescription(error, ta("userDeleteFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    }
  }

  const handleResetUserPassword = async (user: ConsoleUser) => {
    const nextPassword = window.prompt(ta("userResetPasswordPrompt", { username: user.username }))
    if (!nextPassword?.trim()) {
      return
    }

    try {
      await resetAdminUserPassword(
        sessionToken,
        user.id,
        { newPassword: nextPassword },
        DEFAULT_PROVIDER_ID,
      )
      toast({
        title: ta("userPasswordReset"),
        description: user.username,
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("userPasswordResetFailed"),
        description: getErrorDescription(error, ta("userPasswordResetFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    }
  }

  const handleEditUserLimit = async (user: ConsoleUser) => {
    const nextValue = window.prompt(
      ta("userDomainLimitPrompt", { username: user.username }),
      String(user.domainLimit),
    )
    if (nextValue === null) {
      return
    }

    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast({
        title: ta("userUpdateFailed"),
        description: ta("userLimitInvalid"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    await handlePatchUser(user, { domainLimit: parsed })
  }

  const handleSaveSettings = async () => {
    if (!sessionToken.trim() || !isAdmin) {
      return
    }

    setSettingsSaving(true)
    try {
      const settings = await updateAdminSystemSettings(
        sessionToken,
        settingsDraft,
        DEFAULT_PROVIDER_ID,
      )
      setSettingsDraft(settings)
      setSessionInfo((current) => (current ? { ...current, systemSettings: settings } : current))
      toast({
        title: ta("settingsSaved"),
        color: "success",
        variant: "flat",
      })
      await loadOps(true)
    } catch (error) {
      toast({
        title: ta("settingsSaveFailed"),
        description: getErrorDescription(error, ta("settingsSaveFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleRunCleanup = async () => {
    if (!sessionToken.trim()) {
      return
    }

    setIsRunningCleanup(true)
    try {
      const report = await runAdminCleanup(sessionToken, DEFAULT_PROVIDER_ID)
      toast({
        title: ta("cleanupCompleted"),
        description: ta("cleanupCompletedDescription", {
          accounts: report.deletedAccounts,
          messages: report.deletedMessages,
          domains: report.deletedDomains,
        }),
        color: "success",
        variant: "flat",
      })
      await Promise.all([loadManagedDomains(true), loadOps(true)])
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

  const menuItems = [
    { id: "overview" as const, label: ta("menuOverview"), icon: Server },
    { id: "domains" as const, label: ta("menuDomains"), icon: Globe2 },
    ...(isAdmin ? [{ id: "users" as const, label: ta("menuUsers"), icon: Users2 }] : []),
    { id: "security" as const, label: ta("menuSecurity"), icon: KeyRound },
    ...(isAdmin ? [{ id: "logs" as const, label: ta("menuLogs"), icon: ReceiptText }] : []),
  ]

  if (isBootstrapping) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-8 text-slate-900 dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100 md:px-6">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-slate-200/80 bg-white/92 p-6 text-sm text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300">
          {ta("loadingStatus")}
        </div>
      </div>
    )
  }

  if (isRedirectingToEntry || !hasAdminSession || !sessionInfo || !currentUser) {
    return null
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-6 text-slate-900 dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100 md:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[96rem] flex-col gap-6 lg:flex-row">
        <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-80 lg:flex-none">
          <Card className="h-full border border-slate-200/80 bg-white/92 dark:border-slate-800 dark:bg-slate-950/70">
            <CardBody className="flex h-full flex-col gap-5 p-4">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600 dark:text-sky-300">
                  TmpMail Console
                </div>
                <div className="text-xl font-semibold text-slate-950 dark:text-white">
                  {ta("inventoryTitle")}
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-300">
                  {currentUser.username} · {currentUser.role}
                </div>
              </div>

              {!canUseSensitiveAdminActions && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
                  <div className="flex items-center gap-2 font-semibold">
                    <ShieldAlert size={15} />
                    {ta("insecureContextTitle")}
                  </div>
                  <div className="mt-1">{ta("insecureContextDescription")}</div>
                </div>
              )}

              <div className="space-y-2">
                {menuItems.map((item) => {
                  const Icon = item.icon
                  const active = view === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setView(item.id)}
                      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition ${
                        active
                          ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-900"
                      }`}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-auto space-y-3">
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {tt("label")}
                  </div>
                  <ThemeModeToggle
                    showLabel
                    fullWidth
                    variant="flat"
                    buttonClassName="mt-3 rounded-xl bg-white/90 px-3 text-slate-700 shadow-sm dark:bg-slate-950/80 dark:text-slate-200"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    variant="flat"
                    startContent={<ArrowLeft size={16} />}
                    onPress={() => router.push("/")}
                  >
                    {tc("back")}
                  </Button>
                  <Button
                    color="danger"
                    variant="flat"
                    startContent={<LogOut size={16} />}
                    onPress={clearAdminSession}
                  >
                    {ta("logout")}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </aside>

        <main className="min-w-0 flex-1 space-y-6">
          <ConsoleSectionHeader
            title={sectionMeta.title}
            badge={currentUser.role === "admin" ? ta("roleAdmin") : ta("roleUser")}
            meta={[
              {
                label: ta("serviceStatus"),
                value: serviceStatus?.status || "loading",
              },
              {
                label: ta("managedDomainCount"),
                value: String(managedDomains.length),
              },
              {
                label: ta("menuUsers"),
                value: isAdmin ? String(adminUsers.length) : currentUser.username,
              },
            ]}
          />

          {view === "overview" && (
            <>
              <section className="grid gap-4 md:grid-cols-3">
                <StatCard
                  icon={<Activity size={18} />}
                  label={ta("serviceStatus")}
                  value={serviceStatus?.status || "loading"}
                  tone={serviceStatus?.status === "ready" ? "success" : serviceStatus?.status === "offline" ? "danger" : "warning"}
                />
                <StatCard
                  icon={<Server size={18} />}
                  label={ta("storeBackend")}
                  value={serviceStatus?.storeBackend || "unknown"}
                  tone="neutral"
                />
                <StatCard
                  icon={<Globe2 size={18} />}
                  label={ta("managedDomainCount")}
                  value={String(managedDomains.length)}
                  tone="neutral"
                />
              </section>

              <Card className="border border-slate-200/80 bg-white/92 dark:border-slate-800 dark:bg-slate-950/70">
                <CardBody className="gap-5 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold">{ta("overviewSettingsTitle")}</div>
                    </div>
                    {isAdmin && (
                      <Button
                        color="primary"
                        onPress={handleSaveSettings}
                        isLoading={settingsSaving}
                      >
                        {tc("save")}
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                      <div className="text-sm font-medium">{ta("systemEnabledLabel")}</div>
                      <div className="mt-3 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={settingsDraft.systemEnabled}
                          disabled={!isAdmin}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              systemEnabled: event.target.checked,
                            }))
                          }
                        />
                        <span className="text-sm">
                          {settingsDraft.systemEnabled ? ta("systemEnabledOn") : ta("systemEnabledOff")}
                        </span>
                      </div>
                    </label>

                    <Input
                      label={ta("mailExchangeHostLabel")}
                      placeholder="mail.example.com"
                      value={settingsDraft.mailExchangeHost || ""}
                      isDisabled={!isAdmin}
                      onValueChange={(value) =>
                        setSettingsDraft((current) => ({ ...current, mailExchangeHost: value }))
                      }
                      variant="bordered"
                    />
                    <Input
                      label={ta("mailRouteTargetLabel")}
                      placeholder="23.165.200.136"
                      value={settingsDraft.mailRouteTarget || ""}
                      isDisabled={!isAdmin}
                      onValueChange={(value) =>
                        setSettingsDraft((current) => ({ ...current, mailRouteTarget: value }))
                      }
                      variant="bordered"
                    />
                    <Input
                      label={ta("domainTxtPrefixLabel")}
                      placeholder="@"
                      value={settingsDraft.domainTxtPrefix || ""}
                      isDisabled={!isAdmin}
                      onValueChange={(value) =>
                        setSettingsDraft((current) => ({ ...current, domainTxtPrefix: value }))
                      }
                      variant="bordered"
                    />
                  </div>
                </CardBody>
              </Card>
            </>
          )}

          {view === "domains" && (
            <Card className="border border-slate-200/80 bg-white/92 dark:border-slate-800 dark:bg-slate-950/70">
              <CardBody className="gap-5 p-5">
                <section className="grid gap-3 md:grid-cols-3">
                  <StatCard
                    icon={<Globe2 size={18} />}
                    label={ta("managedDomainCount")}
                    value={String(managedDomains.length)}
                    tone="neutral"
                  />
                  <StatCard
                    icon={<CheckCircle2 size={18} />}
                    label={ts("domainStatusActive")}
                    value={String(activeDomainsCount)}
                    tone="success"
                  />
                  <StatCard
                    icon={<Activity size={18} />}
                    label={ts("domainStatusPending")}
                    value={String(pendingDomainsCount)}
                    tone="warning"
                  />
                </section>

                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">{ta("domainPanelTitle")}</div>
                  </div>
                  <Button
                    variant="flat"
                    startContent={<RefreshCw size={16} />}
                    onPress={() => void loadManagedDomains()}
                    isLoading={managedDomainsLoading}
                  >
                    {ts("refreshDomains")}
                  </Button>
                </div>

                <div className="rounded-[1.6rem] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/45">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <Input
                      label={ts("domainInputLabel")}
                      placeholder={ts("domainInputPlaceholder")}
                      value={managedDomainInput}
                      onValueChange={setManagedDomainInput}
                      variant="bordered"
                    />
                    <Button
                      color="primary"
                      className="md:self-start"
                      startContent={<Globe2 size={16} />}
                      onPress={handleCreateDomain}
                      isLoading={isCreatingDomain}
                    >
                      {ts("addDomain")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  {managedDomains.length === 0 && (
                    <EmptyPanel
                      title={ts("noManagedDomains")}
                    />
                  )}

                  {managedDomains.map((domain) => (
                    <Card
                      key={domain.id}
                      className="border border-amber-200/70 bg-white/90 dark:border-amber-900/60 dark:bg-slate-950/40"
                    >
                      <CardBody className="gap-4 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-base">{domain.domain}</span>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                domain.isVerified || domain.status === "active"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
                              }`}>
                                {domain.isVerified || domain.status === "active" ? ts("domainStatusActive") : ts("domainStatusPending")}
                              </span>
                              {isAdmin && domain.ownerUserId && usersById[domain.ownerUserId] && (
                                <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-200">
                                  {usersById[domain.ownerUserId].username}
                                </span>
                              )}
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
                              {expandedDomainIds[domain.id] ? ts("hideDnsRecords") : ts("showDnsRecords")}
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
                            {domain.verificationToken && (
                              <Button
                                size="sm"
                                color="danger"
                                variant="flat"
                                startContent={<Trash2 size={15} />}
                                onPress={() => void handleDeleteDomain(domain)}
                                isLoading={deletingDomainId === domain.id}
                              >
                                {ts("deleteDomain")}
                              </Button>
                            )}
                          </div>
                        </div>

                        {expandedDomainIds[domain.id] && recordsByDomainId[domain.id] && (
                          <div className="space-y-3 rounded-[1.4rem] border border-dashed border-amber-300 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/10">
                            <div className="grid gap-3 md:grid-cols-3">
                              {recordsByDomainId[domain.id].map((record) => {
                                const baseKey = `${domain.id}-${record.kind}-${record.name}`
                                return (
                                  <DomainRecordCard
                                    key={baseKey}
                                    record={record}
                                    copyStatePrefix={baseKey}
                                    copiedTarget={copiedDnsTarget}
                                    onCopy={(value, suffix) =>
                                      void handleCopyDnsField(value, `${baseKey}-${suffix}`)
                                    }
                                    labels={{
                                      host: ts("recordHost"),
                                      value: ts("recordValue"),
                                      copyRecord: ta("copyRecord"),
                                    }}
                                    copiedLabel={tc("copied")}
                                  />
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {view === "users" && isAdmin && (
            <Card className="border border-slate-200/80 bg-white/92 dark:border-slate-800 dark:bg-slate-950/70">
              <CardBody className="gap-5 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">{ta("userPanelTitle")}</div>
                  </div>
                  <Button
                    variant="flat"
                    startContent={<RefreshCw size={16} />}
                    onPress={() => void loadUsers()}
                    isLoading={usersLoading}
                  >
                    {ta("refreshUsers")}
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <Input
                    label={ta("consoleUsernameLabel")}
                    value={newUserUsername}
                    onValueChange={setNewUserUsername}
                    variant="bordered"
                  />
                  <Input
                    label={ta("newUserPasswordLabel")}
                    type="password"
                    value={newUserPassword}
                    onValueChange={setNewUserPassword}
                    variant="bordered"
                  />
                  <label className="rounded-2xl border border-slate-200 p-3 text-sm dark:border-slate-800">
                    <div className="font-medium">{ta("userRoleLabel")}</div>
                    <select
                      className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                      value={newUserRole}
                      onChange={(event) => setNewUserRole(event.target.value as "admin" | "user")}
                    >
                      <option value="user">{ta("roleUser")}</option>
                      <option value="admin">{ta("roleAdmin")}</option>
                    </select>
                  </label>
                  <Input
                    label={ta("domainLimitLabel")}
                    value={newUserDomainLimit}
                    onValueChange={setNewUserDomainLimit}
                    variant="bordered"
                  />
                </div>

                <Button
                  color="primary"
                  onPress={handleCreateUser}
                  isLoading={creatingUser}
                  className="self-start"
                >
                  {ta("createUser")}
                </Button>

                <div className="space-y-3">
                  {adminUsers.length === 0 && (
                    <EmptyPanel
                      title={ta("userEmptyTitle")}
                    />
                  )}
                  {adminUsers.map((user) => (
                    <Card key={user.id} className="border border-slate-200/80 dark:border-slate-800">
                      <CardBody className="gap-4 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold">{user.username}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-300">
                              {user.role} · {ta("domainLimitValue", { count: user.domainLimit })}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <select
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                              value={user.role}
                              onChange={(event) =>
                                void handlePatchUser(user, { role: event.target.value as ConsoleUser["role"] })
                              }
                            >
                              <option value="user">{ta("roleUser")}</option>
                              <option value="admin">{ta("roleAdmin")}</option>
                            </select>
                            <Button
                              size="sm"
                              variant="flat"
                              onPress={() => void handleEditUserLimit(user)}
                            >
                              {ta("editDomainLimit")}
                            </Button>
                            <Button
                              size="sm"
                              variant="flat"
                              onPress={() =>
                                void handlePatchUser(user, { isDisabled: !user.isDisabled })
                              }
                            >
                              {user.isDisabled ? ta("enableUser") : ta("disableUser")}
                            </Button>
                            <Button
                              size="sm"
                              variant="flat"
                              onPress={() => void handleResetUserPassword(user)}
                            >
                              {ta("resetUserPassword")}
                            </Button>
                            <Button
                              size="sm"
                              color="danger"
                              variant="flat"
                              onPress={() => void handleDeleteUser(user)}
                            >
                              {tc("delete")}
                            </Button>
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {view === "security" && (
            <Card className="border border-slate-200/80 bg-white/92 dark:border-slate-800 dark:bg-slate-950/70">
              <CardBody className="gap-6 p-5">
                <div>
                  <div className="text-lg font-semibold">{ta("securityPanelTitle")}</div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="border border-slate-200/80 dark:border-slate-800">
                    <CardBody className="gap-4 p-4">
                      <div className="flex items-center gap-2 text-lg font-semibold">
                        <KeyRound size={18} />
                        {ta("apiKeySettings")}
                      </div>
                      <div className="rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          {ta("apiKeyGeneratedLabel")}
                        </div>
                        <div className="mt-2 break-all font-mono text-sm">
                          {hasVisibleAdminKey ? adminApiKey : ta("apiKeyEmptyState")}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="flat"
                          startContent={<RefreshCw size={16} />}
                          onPress={handleRevealAdminKey}
                          isLoading={isRefreshingKey}
                        >
                          {ta("apiKeyGenerate")}
                        </Button>
                        <Button
                          variant="flat"
                          startContent={<RotateCw size={16} />}
                          onPress={handleRegenerateKey}
                          isLoading={isRefreshingKey}
                        >
                          {ta("apiKeyKeepUsing")}
                        </Button>
                        <Button
                          variant="flat"
                          startContent={<Copy size={16} />}
                          onPress={handleCopyAdminKey}
                          isDisabled={!hasVisibleAdminKey}
                        >
                          {copiedKey ? tc("copied") : ta("apiKeyCopy")}
                        </Button>
                      </div>
                    </CardBody>
                  </Card>

                  <Card className="border border-slate-200/80 dark:border-slate-800">
                    <CardBody className="gap-4 p-4">
                      <div className="text-lg font-semibold">{ta("passwordPanelTitle")}</div>
                      <Input
                        label={ta("currentPasswordLabel")}
                        type="password"
                        value={currentPassword}
                        onValueChange={setCurrentPassword}
                        variant="bordered"
                      />
                      <Input
                        label={ta("newPasswordLabel")}
                        type="password"
                        value={nextPassword}
                        onValueChange={setNextPassword}
                        variant="bordered"
                      />
                      <Button
                        color="primary"
                        onPress={handleUpdatePassword}
                        isLoading={isUpdatingPassword}
                      >
                        {ta("updatePasswordSubmit")}
                      </Button>
                    </CardBody>
                  </Card>
                </div>
              </CardBody>
            </Card>
          )}

          {view === "logs" && isAdmin && (
            <>
              <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                <StatCard
                  icon={<Globe2 size={18} />}
                  label={ta("opsDomains")}
                  value={String(adminMetrics?.totalDomains ?? 0)}
                  tone="neutral"
                />
                <StatCard
                  icon={<CheckCircle2 size={18} />}
                  label={ta("opsPendingDomains")}
                  value={String(adminMetrics?.pendingDomains ?? 0)}
                  tone="warning"
                />
                <StatCard
                  icon={<Users2 size={18} />}
                  label={ta("opsAccounts")}
                  value={String(adminMetrics?.totalAccounts ?? 0)}
                  tone="neutral"
                />
                <StatCard
                  icon={<ReceiptText size={18} />}
                  label={ta("opsMessages")}
                  value={String(adminMetrics?.totalMessages ?? 0)}
                  tone="neutral"
                />
                <StatCard
                  icon={<Activity size={18} />}
                  label={ta("opsSyncFailures")}
                  value={String(adminMetrics?.inbucketSyncFailuresTotal ?? 0)}
                  tone="danger"
                />
                <StatCard
                  icon={<Trash2 size={18} />}
                  label={ta("opsCleanupRuns")}
                  value={String(adminMetrics?.cleanupRunsTotal ?? 0)}
                  tone="neutral"
                />
              </section>

              <Card className="border border-slate-200/80 bg-white/92 dark:border-slate-800 dark:bg-slate-950/70">
                <CardBody className="gap-5 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold">{ta("logsPanelTitle")}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="flat"
                        startContent={<RefreshCw size={16} />}
                        onPress={() => void loadOps()}
                        isLoading={logsLoading}
                      >
                        {ta("refreshOps")}
                      </Button>
                      <Button
                        color="danger"
                        variant="flat"
                        onPress={handleRunCleanup}
                        isLoading={isRunningCleanup}
                      >
                        {ta("runCleanup")}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-sm dark:border-slate-700 dark:bg-slate-900/40">
                    {adminAuditLogs.length === 0 ? (
                      <EmptyPanel
                        title={ta("logsEmptyTitle")}
                        compact
                      />
                    ) : (
                      adminAuditLogs.map((entry) => (
                        <div key={entry} className="font-mono text-xs leading-6">
                          {entry}
                        </div>
                      ))
                    )}
                  </div>
                </CardBody>
              </Card>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string
  tone: "success" | "warning" | "danger" | "neutral"
}) {
  const toneClassName =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
        : tone === "danger"
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
          : "border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"

  return (
    <Card className={`border ${toneClassName}`}>
      <CardBody className="gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">{icon}{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </CardBody>
    </Card>
  )
}

function ConsoleSectionHeader({
  title,
  badge,
  meta,
}: {
  title: string
  badge: string
  meta: Array<{ label: string; value: string }>
}) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/65">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-200">
            {badge}
          </div>
          <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            {title}
          </div>
        </div>

        <div className="grid min-w-[16rem] gap-2 sm:grid-cols-3">
          {meta.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                {item.label}
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function EmptyPanel({
  title,
  description,
  compact = false,
}: {
  title: string
  description?: string
  compact?: boolean
}) {
  return (
    <div className={`rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/75 text-slate-600 dark:border-slate-700 dark:bg-slate-900/35 dark:text-slate-300 ${compact ? "p-4" : "p-6"}`}>
      <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
      {description && <div className="mt-2 text-sm leading-6">{description}</div>}
    </div>
  )
}

function DomainRecordCard({
  record,
  copyStatePrefix,
  copiedTarget,
  onCopy,
  labels,
  copiedLabel,
}: {
  record: DomainDnsRecord
  copyStatePrefix: string
  copiedTarget: string
  onCopy: (value: string, suffix: string) => void
  labels: {
    host: string
    value: string
    copyRecord: string
  }
  copiedLabel: string
}) {
  const fullRecord = renderRecordValue(record)

  return (
    <div className="rounded-2xl border border-amber-300 bg-white/80 p-4 shadow-sm dark:border-amber-800 dark:bg-slate-950/30">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          {record.kind}
        </div>
        <div className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
          TTL {record.ttl}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            {labels.host}
          </div>
          <div className="mt-2 break-all font-mono text-sm text-slate-900 dark:text-slate-100">
            {record.name}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            {labels.value}
          </div>
          <div className="mt-2 break-all font-mono text-sm text-slate-900 dark:text-slate-100">
            {record.value}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="flat" onPress={() => onCopy(record.name, "host")}>
          {copiedTarget === `${copyStatePrefix}-host` ? copiedLabel : labels.host}
        </Button>
        <Button size="sm" variant="flat" onPress={() => onCopy(record.value, "value")}>
          {copiedTarget === `${copyStatePrefix}-value` ? copiedLabel : labels.value}
        </Button>
        <Button size="sm" variant="flat" onPress={() => onCopy(fullRecord, "record")}>
          {copiedTarget === `${copyStatePrefix}-record` ? copiedLabel : labels.copyRecord}
        </Button>
      </div>
    </div>
  )
}
