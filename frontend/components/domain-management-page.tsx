"use client"

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  useSyncExternalStore,
} from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@heroui/button"
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal"
import { Spinner } from "@heroui/spinner"
import {
  Activity,
  Check,
  Cloud,
  Copy,
  Globe2,
  Inbox,
  KeyRound,
  Languages,
  LogOut,
  Mail,
  Menu,
  Plus,
  ReceiptText,
  RefreshCw,
  SlidersHorizontal,
  Server,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users2,
  X,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useAuth } from "@/contexts/auth-context"
import { useBranding } from "@/contexts/branding-context"
import BrandMark from "@/components/brand-mark"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { usePathname, useRouter } from "@/i18n/navigation"
import {
  type AdminAccessKey,
  type AdminInviteCode,
  createAdminAccessKey,
  createAdminInviteCode,
  createAdminUser,
  deleteAdminSession,
  type AdminMetricsResponse,
  type AdminSessionInfo,
  type AdminSystemSettings,
  type AdminUpdateSystemSettingsRequest,
  type ConsoleCloudflareSettings,
  createOwnedAccount,
  type ConsoleUser,
  clearAdminAuditLogs,
  createManagedDomain,
  deleteAdminAccessKey,
  deleteAdminInviteCode,
  deleteAdminUser,
  deleteOwnedAccount,
  deleteManagedDomain,
  fetchAdminAccessKeys,
  fetchAdminInviteCodes,
  fetchConsoleCloudflareSettings,
  fetchOwnedAccounts,
  fetchAdminUsers,
  fetchManagedDomains,
  fetchServiceStatus,
  getAdminAuditLogs,
  getAdminMetrics,
  getAdminSessionInfo,
  getManagedDomainRecords,
  getToken,
  issueOwnedAccountToken,
  resetAdminUserPassword,
  runAdminCleanup,
  syncManagedDomainCloudflare,
  testConsoleCloudflareToken,
  updateConsoleCloudflareSettings,
  updateAdminInviteCode,
  updateManagedDomainSharing,
  updateAdminPassword,
  updateAdminSystemSettings,
  updateAdminUser,
  restoreAdminSessionInfo,
  verifyManagedDomain,
} from "@/lib/api"
import {
  clearStoredAdminSession,
  clearStoredPendingRevealedAdminKey,
  clearStoredRevealedAdminKey,
  hasStoredAdminSession,
  getStoredPendingRevealedAdminKey,
  getStoredRevealedAdminKeys,
  setStoredAdminSession,
  takePendingAdminSession,
  storeRevealedAdminKey,
  subscribeToAdminSession,
  type StoredAdminKey,
  type StoredAdminKeyMap,
} from "@/lib/admin-session"
import MessageDetail from "@/components/message-detail"
import MessageList from "@/components/message-list"
import ConsoleActionModal from "@/components/console-action-modal"
import type { Account, Domain, DomainDnsRecord, Message } from "@/types"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"
import { generateRandomUsername } from "@/lib/account-credentials"
import ThemeModeToggle from "@/components/theme-mode-toggle"
import { TM_INPUT_CLASSNAMES } from "@/components/heroui-field-styles"
import { Input, Select, SelectItem, Textarea } from "@/components/tm-form-fields"
import { replaceBrandNameText, resolveSiteBranding } from "@/lib/site-branding"

const ADMIN_KEY_VISIBLE_MS = 60_000
const DEFAULT_CLOUDFLARE_SETTINGS: ConsoleCloudflareSettings = {
  enabled: false,
  apiTokenConfigured: false,
  autoSyncEnabled: true,
}
const MAX_BATCH_MANAGED_DOMAINS = 50
const MAX_BATCH_DOMAIN_PREFIX_LENGTH = 40
const MIN_BATCH_DOMAIN_RANDOM_LENGTH = 4
const MAX_BATCH_DOMAIN_RANDOM_LENGTH = 20
const BATCH_CLOUDFLARE_ZONE_LOAD_TIMEOUT_MS = 12_000
const LINUX_DO_CONNECT_PORTAL_URL = "https://connect.linux.do/"
const LINUX_DO_DEFAULT_AUTHORIZE_URL = "https://connect.linux.do/oauth2/authorize"
const LINUX_DO_DEFAULT_TOKEN_URL = "https://connect.linux.do/oauth2/token"
const LINUX_DO_DEFAULT_USERINFO_URL = "https://connect.linux.do/api/user"

const normalizeCloudflareSettings = (
  settings: ConsoleCloudflareSettings,
): ConsoleCloudflareSettings => ({
  ...DEFAULT_CLOUDFLARE_SETTINGS,
  ...settings,
})

function defaultSmtpPortForSecurity(security: AdminSystemSettings["smtp"]["security"]): number {
  switch (security) {
    case "plain":
      return 25
    case "tls":
      return 465
    case "starttls":
    default:
      return 587
  }
}

const DEFAULT_SMTP_SETTINGS: AdminSystemSettings["smtp"] = {
  port: defaultSmtpPortForSecurity("starttls"),
  passwordConfigured: false,
  security: "starttls",
}
const DEFAULT_SETTINGS: AdminSystemSettings = {
  systemEnabled: true,
  branding: {},
  smtp: DEFAULT_SMTP_SETTINGS,
  registrationSettings: {
    openRegistrationEnabled: true,
    consoleInviteCodeRequired: false,
    allowedEmailSuffixes: [],
    emailOtp: {
      enabled: false,
      ttlSeconds: 600,
      cooldownSeconds: 60,
    },
    linuxDo: {
      enabled: false,
      clientSecretConfigured: false,
      minimumTrustLevel: 0,
    },
  },
  userLimits: {
    defaultDomainLimit: 3,
    mailboxLimit: 5,
    apiKeyLimit: 5,
  },
}

interface DomainManagementPageProps {
  entryPath: string
  requireSecureTransport: boolean
}

type ConsoleView = "mailboxes" | "overview" | "settings" | "domains" | "users" | "security" | "logs"
type SettingsSection = "core" | "registration" | "limits" | "integrations" | "cloudflare"
type ActionDialogTone = "primary" | "danger"
type MetricCardTone = "success" | "warning" | "danger" | "neutral"

type ConfirmActionDialogState = {
  kind: "confirm"
  title: string
  description?: string
  confirmLabel: string
  tone: ActionDialogTone
  resolve: (confirmed: boolean) => void
}

type InputActionDialogState = {
  kind: "input"
  title: string
  description?: string
  confirmLabel: string
  tone: ActionDialogTone
  inputLabel: string
  inputType?: "text" | "password" | "number"
  inputMode?: "text" | "numeric" | "decimal" | "email" | "search" | "tel" | "url" | "none"
  inputPlaceholder?: string
  value: string
  validate?: (value: string) => string | null
  resolve: (value: string | null) => void
}

type ActionDialogState = ConfirmActionDialogState | InputActionDialogState

type BatchDomainProgressState = {
  total: number
  completed: number
  created: number
  synced: number
  failed: number
  currentDomain: string
}

function parseSuffixList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseIntegerInput(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "0%"
  }

  return `${value.toFixed(1).replace(/\.0$/, "")}%`
}

function formatBytes(value: number | undefined): string {
  if (!value || value <= 0) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  let current = value
  let unitIndex = 0

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }

  const precision = current >= 10 || unitIndex === 0 ? 0 : 1
  return `${current.toFixed(precision).replace(/\.0$/, "")} ${units[unitIndex]}`
}

function formatUptime(value: number | undefined, locale: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return locale === "zh" ? "0 秒" : "0s"
  }

  const totalSeconds = Math.floor(value)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  const parts =
    locale === "zh"
      ? [
          days > 0 ? `${days} 天` : null,
          hours > 0 ? `${hours} 小时` : null,
          minutes > 0 ? `${minutes} 分钟` : null,
          seconds > 0 ? `${seconds} 秒` : null,
        ]
      : [
          days > 0 ? `${days}d` : null,
          hours > 0 ? `${hours}h` : null,
          minutes > 0 ? `${minutes}m` : null,
          seconds > 0 ? `${seconds}s` : null,
        ]

  return parts.filter(Boolean).slice(0, 3).join(" ") || (locale === "zh" ? "0 秒" : "0s")
}

function formatRatioPercent(part: number | undefined, total: number | undefined): number | undefined {
  if (typeof part !== "number" || typeof total !== "number" || total <= 0) {
    return undefined
  }

  return Math.max(0, Math.min(100, (part / total) * 100))
}

function getConsoleRoleBadgeClassName(role: ConsoleUser["role"]): string {
  return role === "admin"
    ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
    : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/35 dark:text-emerald-200"
}

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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(errorMessage))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

function areSettingsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function buildSettingsSavePayload(
  draft: AdminSystemSettings,
  saved: AdminSystemSettings,
): AdminUpdateSystemSettingsRequest {
  const payload: AdminUpdateSystemSettingsRequest = {}

  if (draft.systemEnabled !== saved.systemEnabled) {
    payload.systemEnabled = draft.systemEnabled
  }
  if (draft.mailExchangeHost !== saved.mailExchangeHost) {
    payload.mailExchangeHost = draft.mailExchangeHost ?? ""
  }
  if (draft.mailRouteTarget !== saved.mailRouteTarget) {
    payload.mailRouteTarget = draft.mailRouteTarget ?? ""
  }
  if (draft.domainTxtPrefix !== saved.domainTxtPrefix) {
    payload.domainTxtPrefix = draft.domainTxtPrefix ?? ""
  }
  if (!areSettingsEqual(draft.branding, saved.branding)) {
    payload.branding = {
      name: draft.branding.name ?? "",
      logoUrl: draft.branding.logoUrl ?? "",
    }
  }
  if (!areSettingsEqual(draft.smtp, saved.smtp)) {
    payload.smtp = {
      ...draft.smtp,
      host: draft.smtp.host ?? "",
      username: draft.smtp.username ?? "",
      fromAddress: draft.smtp.fromAddress ?? "",
      fromName: draft.smtp.fromName ?? "",
    }
  }
  if (!areSettingsEqual(draft.registrationSettings, saved.registrationSettings)) {
    payload.registrationSettings = draft.registrationSettings
  }
  if (!areSettingsEqual(draft.userLimits, saved.userLimits)) {
    payload.userLimits = draft.userLimits
  }

  return payload
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

function normalizeManagedDomainEntry(value: string): string {
  return value.trim().replace(/\.+$/, "").toLowerCase()
}

function normalizeManagedDomainPrefix(value: string): string {
  return value.trim().toLowerCase()
}

function isValidManagedDomainPrefix(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
}

function buildRandomManagedDomains(
  rootDomain: string,
  prefix: string,
  randomLength: number,
  count: number,
  existingDomains: Set<string>,
): string[] {
  const normalizedRootDomain = normalizeManagedDomainEntry(rootDomain)
  const normalizedPrefix = normalizeManagedDomainPrefix(prefix)
  const domains: string[] = []
  const seen = new Set(existingDomains)
  const maxAttempts = Math.max(count * 20, 50)
  let attempts = 0

  while (domains.length < count && attempts < maxAttempts) {
    attempts += 1
    const randomSuffix = generateRandomUsername(randomLength).toLowerCase()
    const candidate = `${normalizedPrefix}-${randomSuffix}.${normalizedRootDomain}`
    if (seen.has(candidate)) {
      continue
    }

    seen.add(candidate)
    domains.push(candidate)
  }

  return domains
}

function sortMailboxAccounts(accounts: Account[]): Account[] {
  return [...accounts].sort((left, right) => left.address.localeCompare(right.address))
}

function mailboxDomain(address: string): string {
  const separatorIndex = address.lastIndexOf("@")
  if (separatorIndex < 0) {
    return ""
  }

  return address.slice(separatorIndex + 1).trim().toLowerCase()
}

function matchesMaskedAdminKey(apiKey: string, maskedKey: string): boolean {
  const trimmedApiKey = apiKey.trim()
  const trimmedMaskedKey = maskedKey.trim()
  if (trimmedApiKey.length <= 8 || !trimmedMaskedKey) {
    return false
  }

  return trimmedMaskedKey === `${trimmedApiKey.slice(0, 6)}...${trimmedApiKey.slice(-4)}`
}

function renderRecordValue(record: DomainDnsRecord) {
  return `${record.name} -> ${record.value}`
}

export default function DomainManagementPage({
  entryPath,
  requireSecureTransport,
}: DomainManagementPageProps) {
  const [isLocalePending, startLocaleTransition] = useTransition()
  const { toast } = useHeroUIToast()
  const {
    currentAccount,
    accounts: storedMailboxAccounts,
    token: mailboxToken,
    activateAccount,
    clearAccounts,
    syncAccounts,
  } = useAuth()
  const { brandName, setBranding } = useBranding()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const ta = useTranslations("admin")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const th = useTranslations("header")
  const tm = useTranslations("mainPage")

  const [view, setView] = useState<ConsoleView>("mailboxes")
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [sessionInfo, setSessionInfo] = useState<AdminSessionInfo | null>(null)
  const [serviceStatus, setServiceStatus] = useState<{
    status: "ready" | "degraded" | "offline"
    storeBackend?: string
  } | null>(null)
  const [mailboxAccounts, setMailboxAccounts] = useState<Account[]>([])
  const [mailboxAccountsLoading, setMailboxAccountsLoading] = useState(false)
  const [mailboxLocalPartInput, setMailboxLocalPartInput] = useState("")
  const [mailboxDomainInput, setMailboxDomainInput] = useState("")
  const [isCreatingMailbox, setIsCreatingMailbox] = useState(false)
  const [activatingMailboxId, setActivatingMailboxId] = useState<string | null>(null)
  const [deletingMailboxId, setDeletingMailboxId] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [mailboxRefreshKey, setMailboxRefreshKey] = useState(0)
  const [managedDomains, setManagedDomains] = useState<Domain[]>([])
  const [managedDomainsLoading, setManagedDomainsLoading] = useState(false)
  const [managedDomainInput, setManagedDomainInput] = useState("")
  const [isCreatingDomain, setIsCreatingDomain] = useState(false)
  const [isBatchDomainModalOpen, setIsBatchDomainModalOpen] = useState(false)
  const [cloudflareZoneOptions, setCloudflareZoneOptions] = useState<string[]>([])
  const [cloudflareZonesLoading, setCloudflareZonesLoading] = useState(false)
  const [cloudflareZonesRequireApiUpdate, setCloudflareZonesRequireApiUpdate] = useState(false)
  const [cloudflareZoneLoadError, setCloudflareZoneLoadError] = useState<string | null>(null)
  const [batchDomainRootInput, setBatchDomainRootInput] = useState("")
  const [batchDomainPrefixInput, setBatchDomainPrefixInput] = useState("")
  const [batchDomainRandomLengthInput, setBatchDomainRandomLengthInput] = useState("6")
  const [batchDomainCountInput, setBatchDomainCountInput] = useState("10")
  const [isCreatingDomainBatch, setIsCreatingDomainBatch] = useState(false)
  const [batchDomainProgress, setBatchDomainProgress] = useState<BatchDomainProgressState | null>(
    null,
  )
  const [recordsByDomainId, setRecordsByDomainId] = useState<Record<string, DomainDnsRecord[]>>({})
  const [recordsLoadingById, setRecordsLoadingById] = useState<Record<string, boolean>>({})
  const [expandedDomainIds, setExpandedDomainIds] = useState<Record<string, boolean>>({})
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(null)
  const [sharingDomainId, setSharingDomainId] = useState<string | null>(null)
  const [deletingDomainId, setDeletingDomainId] = useState<string | null>(null)
  const [adminUsers, setAdminUsers] = useState<ConsoleUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [newUsername, setNewUsername] = useState("")
  const [newUserPassword, setNewUserPassword] = useState("")
  const [newUserDomainLimit, setNewUserDomainLimit] = useState("3")
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [adminMetrics, setAdminMetrics] = useState<AdminMetricsResponse | null>(null)
  const [adminAuditLogs, setAdminAuditLogs] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [isClearingLogs, setIsClearingLogs] = useState(false)
  const [isRunningCleanup, setIsRunningCleanup] = useState(false)
  const [adminAccessKeys, setAdminAccessKeys] = useState<AdminAccessKey[]>([])
  const [accessKeysLoading, setAccessKeysLoading] = useState(false)
  const [newAccessKeyName, setNewAccessKeyName] = useState("")
  const [isCreatingAccessKey, setIsCreatingAccessKey] = useState(false)
  const [deletingAccessKeyId, setDeletingAccessKeyId] = useState<string | null>(null)
  const [adminInviteCodes, setAdminInviteCodes] = useState<AdminInviteCode[]>([])
  const [inviteCodesLoading, setInviteCodesLoading] = useState(false)
  const [newInviteCodeName, setNewInviteCodeName] = useState("")
  const [newInviteCodeMaxUses, setNewInviteCodeMaxUses] = useState("")
  const [isCreatingInviteCode, setIsCreatingInviteCode] = useState(false)
  const [updatingInviteCodeId, setUpdatingInviteCodeId] = useState<string | null>(null)
  const [deletingInviteCodeId, setDeletingInviteCodeId] = useState<string | null>(null)
  const [pendingInviteCode, setPendingInviteCode] = useState<{
    code: AdminInviteCode
    inviteCode: string
  } | null>(null)
  const [revealedAdminKeys, setRevealedAdminKeys] = useState<StoredAdminKeyMap>({})
  const [pendingRevealedAdminKey, setPendingRevealedAdminKey] = useState<StoredAdminKey | null>(
    null,
  )
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [copiedInviteCodeId, setCopiedInviteCodeId] = useState<string | null>(null)
  const [copiedDnsTarget, setCopiedDnsTarget] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [nextPassword, setNextPassword] = useState("")
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<AdminSystemSettings>(DEFAULT_SETTINGS)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("core")
  const [isUpdatingSystemEnabled, setIsUpdatingSystemEnabled] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [cloudflareSettings, setCloudflareSettings] = useState<ConsoleCloudflareSettings>(
    DEFAULT_CLOUDFLARE_SETTINGS,
  )
  const [cloudflareApiTokenInput, setCloudflareApiTokenInput] = useState("")
  const [savedCloudflareSettings, setSavedCloudflareSettings] = useState<ConsoleCloudflareSettings>(
    DEFAULT_CLOUDFLARE_SETTINGS,
  )
  const [cloudflareSaving, setCloudflareSaving] = useState(false)
  const [cloudflareTesting, setCloudflareTesting] = useState(false)
  const [cloudflareSyncingDomainId, setCloudflareSyncingDomainId] = useState<string | null>(null)
  const [isSecureAdminContext, setIsSecureAdminContext] = useState(() => !requireSecureTransport)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null)
  const [actionDialogError, setActionDialogError] = useState<string | null>(null)
  const [browserOrigin, setBrowserOrigin] = useState("")
  const currentMailboxAccountRef = useRef(currentAccount)
  const mailboxTokenRef = useRef(mailboxToken)
  const hasBootstrappedRef = useRef(false)
  const hasLoadedUsersRef = useRef(false)
  const hasLoadedOpsRef = useRef(false)
  const hasLoadedAccessKeysRef = useRef(false)
  const hasLoadedInviteCodesRef = useRef(false)
  const hasLoadedCloudflareSettingsRef = useRef(false)
  const cloudflareSettingsRef = useRef(DEFAULT_CLOUDFLARE_SETTINGS)
  const batchCloudflareZoneRequestIdRef = useRef(0)
  const isMountedRef = useRef(true)
  const hasClientSession = useSyncExternalStore(
    subscribeToAdminSession,
    hasStoredAdminSession,
    () => true,
  )

  const currentUser = sessionInfo?.user ?? null
  const isAdmin = currentUser?.role === "admin"
  const hasAdminSession = Boolean(sessionInfo)
  const canUseSensitiveAdminActions = !requireSecureTransport || isSecureAdminContext
  const hasReachedAccessKeyLimit = adminAccessKeys.length >= settingsDraft.userLimits.apiKeyLimit
  const currentUserRoleBadgeClassName = currentUser
    ? getConsoleRoleBadgeClassName(currentUser.role)
    : ""

  const closeActionDialog = useCallback(() => {
    setActionDialog((current) => {
      if (!current) {
        return null
      }

      if (current.kind === "confirm") {
        current.resolve(false)
      } else {
        current.resolve(null)
      }

      return null
    })
    setActionDialogError(null)
  }, [])

  const requestConfirmation = useCallback(
    (
      dialog: Omit<ConfirmActionDialogState, "kind" | "resolve">,
    ): Promise<boolean> =>
      new Promise((resolve) => {
        setActionDialogError(null)
        setActionDialog({
          kind: "confirm",
          ...dialog,
          resolve,
        })
      }),
    [],
  )

  const requestInputValue = useCallback(
    (
      dialog: Omit<InputActionDialogState, "kind" | "resolve">,
    ): Promise<string | null> =>
      new Promise((resolve) => {
        setActionDialogError(null)
        setActionDialog({
          kind: "input",
          ...dialog,
          resolve,
        })
      }),
    [],
  )

  const handleActionDialogValueChange = useCallback((value: string) => {
    setActionDialog((current) => {
      if (!current || current.kind !== "input") {
        return current
      }

      return {
        ...current,
        value,
      }
    })
    setActionDialogError(null)
  }, [])

  const handleActionDialogConfirm = useCallback(() => {
    const dialog = actionDialog
    if (!dialog) {
      return
    }

    if (dialog.kind === "input") {
      const validationError = dialog.validate?.(dialog.value) ?? null
      if (validationError) {
        setActionDialogError(validationError)
        return
      }

      setActionDialog(null)
      setActionDialogError(null)
      dialog.resolve(dialog.value)
      return
    }

    setActionDialog(null)
    setActionDialogError(null)
    dialog.resolve(true)
  }, [actionDialog])
  const usersById = useMemo(
    () => Object.fromEntries(adminUsers.map((user) => [user.id, user])),
    [adminUsers],
  )
  const activeMailboxAccountsCount = mailboxAccounts.filter(
    (account) => !account.isDeleted && !account.isDisabled,
  ).length
  const currentUserManagedDomainLimit = currentUser?.domainLimit ?? settingsDraft.userLimits.defaultDomainLimit
  const ownedManagedDomainsCount = useMemo(() => {
    if (!currentUser) {
      return 0
    }

    if (isAdmin) {
      return managedDomains.length
    }

    return managedDomains.filter((domain) => domain.ownerUserId === currentUser.id).length
  }, [currentUser, isAdmin, managedDomains])
  const sharedVisibleDomainsCount = useMemo(() => {
    if (!currentUser || isAdmin) {
      return 0
    }

    return managedDomains.filter(
      (domain) => domain.isShared && domain.ownerUserId !== currentUser.id,
    ).length
  }, [currentUser, isAdmin, managedDomains])
  const managedDomainUsageSummary = useMemo(() => {
    if (isAdmin) {
      return undefined
    }

    if (sharedVisibleDomainsCount > 0) {
      return ta("managedDomainUsageSummaryWithShared", {
        owned: ownedManagedDomainsCount,
        limit: currentUserManagedDomainLimit,
        shared: sharedVisibleDomainsCount,
      })
    }

    return ta("managedDomainUsageSummary", {
      count: ownedManagedDomainsCount,
      limit: currentUserManagedDomainLimit,
    })
  }, [
    currentUserManagedDomainLimit,
    isAdmin,
    ownedManagedDomainsCount,
    sharedVisibleDomainsCount,
    ta,
  ])
  const availableMailboxDomains = useMemo(
    () => managedDomains.filter((domain) => domain.isVerified || domain.status === "active"),
    [managedDomains],
  )
  const mailboxPreviewAddress =
    mailboxLocalPartInput.trim() && mailboxDomainInput
      ? `${mailboxLocalPartInput.trim()}@${mailboxDomainInput}`
      : ""
  const activeDomainsCount = managedDomains.filter((domain) => domain.isVerified || domain.status === "active").length
  const pendingDomainsCount = managedDomains.length - activeDomainsCount
  const serviceTone =
    serviceStatus?.status === "ready"
      ? "success"
      : serviceStatus?.status === "offline"
        ? "danger"
        : "warning"
  const serviceStatusLabel =
    serviceStatus?.status === "ready"
      ? ta("serviceStatusGood")
      : serviceStatus?.status === "offline"
        ? ta("serviceStatusError")
        : ta("serviceStatusWarning")
  const totalDomainsMetric = isAdmin ? adminMetrics?.totalDomains ?? managedDomains.length : managedDomains.length
  const activeDomainsMetric = isAdmin ? adminMetrics?.activeDomains ?? activeDomainsCount : activeDomainsCount
  const pendingDomainsMetric = isAdmin ? adminMetrics?.pendingDomains ?? pendingDomainsCount : pendingDomainsCount
  const totalAccountsMetric = adminMetrics?.totalAccounts ?? 0
  const activeAccountsMetric = adminMetrics?.activeAccounts ?? 0
  const totalMessagesMetric = adminMetrics?.totalMessages ?? 0
  const activeMessagesMetric = adminMetrics?.activeMessages ?? 0
  const deletedMessagesMetric = adminMetrics?.deletedMessages ?? 0
  const overviewDetailCards = useMemo<
    Array<{
      label: string
      value: string
      detail?: string
      tone: MetricCardTone
    }>
  >(() => {
    if (!isAdmin) {
      return []
    }

    return [
      {
        label: ta("overviewUptime"),
        value: formatUptime(adminMetrics?.runtime.uptimeSeconds, locale),
        tone: "neutral",
      },
      {
        label: ta("overviewLiveConnections"),
        value: String(adminMetrics?.sseConnectionsActive ?? 0),
        tone: "neutral",
      },
    ]
  }, [adminMetrics, isAdmin, locale, ta])

  const syncRevealedAdminKeysFromStorage = useCallback(() => {
    setRevealedAdminKeys(getStoredRevealedAdminKeys())
    setPendingRevealedAdminKey(getStoredPendingRevealedAdminKey())
  }, [])

  const getVisibleAdminKeyValue = useCallback(
    (key: AdminAccessKey): string => {
      const revealedKey = revealedAdminKeys[key.id]
      if (revealedKey?.apiKey.trim()) {
        return revealedKey.apiKey
      }

      if (
        pendingRevealedAdminKey?.apiKey &&
        matchesMaskedAdminKey(pendingRevealedAdminKey.apiKey, key.maskedKey)
      ) {
        return pendingRevealedAdminKey.apiKey
      }

      return ""
    },
    [pendingRevealedAdminKey, revealedAdminKeys],
  )

  const normalizeSettings = useCallback((settings: AdminSystemSettings): AdminSystemSettings => {
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      branding: {
        ...DEFAULT_SETTINGS.branding,
        ...settings.branding,
      },
      smtp: {
        ...DEFAULT_SMTP_SETTINGS,
        ...settings.smtp,
      },
      registrationSettings: {
        ...DEFAULT_SETTINGS.registrationSettings,
        ...settings.registrationSettings,
        consoleInviteCodeRequired:
          settings.registrationSettings?.consoleInviteCodeRequired ?? false,
        allowedEmailSuffixes: settings.registrationSettings?.allowedEmailSuffixes ?? [],
        emailOtp: {
          ...DEFAULT_SETTINGS.registrationSettings.emailOtp,
          ...settings.registrationSettings?.emailOtp,
        },
        linuxDo: {
          ...DEFAULT_SETTINGS.registrationSettings.linuxDo,
          ...settings.registrationSettings?.linuxDo,
        },
      },
      userLimits: {
        ...DEFAULT_SETTINGS.userLimits,
        ...settings.userLimits,
      },
    }
  }, [])

  const applySavedSettings = useCallback((settings: AdminSystemSettings) => {
    const normalizedSettings = normalizeSettings(settings)
    setBranding(normalizedSettings.branding)
    setSettingsDraft(normalizedSettings)
    setSessionInfo((current) => (current ? { ...current, systemSettings: normalizedSettings } : current))
  }, [normalizeSettings, setBranding])

  const applyAdminSession = useCallback((session: AdminSessionInfo) => {
    const normalizedSettings = normalizeSettings(session.systemSettings)
    setBranding(normalizedSettings.branding)
    setStoredAdminSession()
    setSessionInfo({ ...session, systemSettings: normalizedSettings })
    setSettingsDraft(normalizedSettings)
    setNewUserDomainLimit(String(normalizedSettings.userLimits.defaultDomainLimit))
  }, [normalizeSettings, setBranding])

  const applyCloudflareSettings = useCallback((settings: ConsoleCloudflareSettings) => {
    const normalized = normalizeCloudflareSettings(settings)
    cloudflareSettingsRef.current = normalized
    setCloudflareSettings(normalized)
    setSavedCloudflareSettings(normalized)
    setCloudflareApiTokenInput("")
  }, [])

  useEffect(() => {
    cloudflareSettingsRef.current = normalizeCloudflareSettings(cloudflareSettings)
  }, [cloudflareSettings])

  useEffect(() => {
    if (availableMailboxDomains.length === 0) {
      setMailboxDomainInput("")
      return
    }

    setMailboxDomainInput((current) =>
      availableMailboxDomains.some((domain) => domain.domain === current)
        ? current
      : availableMailboxDomains[0]?.domain ?? "",
    )
  }, [availableMailboxDomains])

  useEffect(() => {
    if (!isBatchDomainModalOpen) {
      return
    }

    setBatchDomainRootInput((current) => {
      if (current && cloudflareZoneOptions.includes(current)) {
        return current
      }

      return cloudflareZoneOptions[0] ?? ""
    })
  }, [cloudflareZoneOptions, isBatchDomainModalOpen])

  useEffect(() => {
    currentMailboxAccountRef.current = currentAccount
  }, [currentAccount])

  useEffect(() => {
    mailboxTokenRef.current = mailboxToken
  }, [mailboxToken])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setIsSecureAdminContext(!requireSecureTransport || isTrustedAdminContext())
  }, [requireSecureTransport])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    setBrowserOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    const expirationTimes = [
      ...Object.values(revealedAdminKeys).map((item) => item.expiresAt),
      pendingRevealedAdminKey?.expiresAt ?? Number.POSITIVE_INFINITY,
    ].filter((value) => Number.isFinite(value))

    if (expirationTimes.length === 0) {
      return
    }

    const remainingMs = Math.min(...expirationTimes) - Date.now()
    if (remainingMs <= 0) {
      syncRevealedAdminKeysFromStorage()
      setCopiedKeyId(null)
      return
    }

    const timeoutId = window.setTimeout(() => {
      syncRevealedAdminKeysFromStorage()
      setCopiedKeyId(null)
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [pendingRevealedAdminKey, revealedAdminKeys, syncRevealedAdminKeysFromStorage])

  const clearAdminSession = useCallback(async (options?: { revokeServerSession?: boolean }) => {
    hasLoadedUsersRef.current = false
    hasLoadedOpsRef.current = false
    hasLoadedAccessKeysRef.current = false
    hasLoadedInviteCodesRef.current = false
    hasLoadedCloudflareSettingsRef.current = false
    clearStoredAdminSession()
    clearStoredRevealedAdminKey()
    clearAccounts()
    setSessionInfo(null)
    setAdminAccessKeys([])
    setAdminInviteCodes([])
    setRevealedAdminKeys({})
    setPendingRevealedAdminKey(null)
    setPendingInviteCode(null)
    setCopiedKeyId(null)
    setCopiedInviteCodeId(null)
    setCloudflareSettings(DEFAULT_CLOUDFLARE_SETTINGS)
    setSavedCloudflareSettings(DEFAULT_CLOUDFLARE_SETTINGS)
    setCloudflareApiTokenInput("")
    setCloudflareTesting(false)
    setMailboxAccounts([])
    setSelectedMessage(null)
    if (options?.revokeServerSession !== false) {
      try {
        await deleteAdminSession()
      } catch {}
    }
  }, [clearAccounts])

  useEffect(() => {
    if (!isAdmin && ["overview", "users", "logs"].includes(view)) {
      setView("mailboxes")
    }
  }, [isAdmin, view])

  useEffect(() => {
    if (isBootstrapping || !sessionInfo || hasClientSession) {
      return
    }

    void clearAdminSession()
  }, [clearAdminSession, hasClientSession, isBootstrapping, sessionInfo])

  const loadManagedDomains = async (silent = false) => {
    if (!hasAdminSession) {
      return
    }

    setManagedDomainsLoading(true)
    try {
      const domains = await fetchManagedDomains(DEFAULT_PROVIDER_ID)
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

  const loadUsers = useCallback(
    async (silent = false) => {
      if (!hasAdminSession || !isAdmin) {
        return
      }

      setUsersLoading(true)
      try {
        setAdminUsers(await fetchAdminUsers(DEFAULT_PROVIDER_ID))
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
    },
    [hasAdminSession, isAdmin, ta, toast],
  )

  const loadOps = useCallback(
    async (silent = false) => {
      if (!hasAdminSession || !isAdmin) {
        return
      }

      setLogsLoading(true)
      try {
        const [metricsResult, logsResult, statusResult] = await Promise.allSettled([
          getAdminMetrics(DEFAULT_PROVIDER_ID),
          getAdminAuditLogs(DEFAULT_PROVIDER_ID, 60),
          fetchServiceStatus(DEFAULT_PROVIDER_ID),
        ])

        let hasCriticalFailure = false

        if (metricsResult.status === "fulfilled") {
          setAdminMetrics(metricsResult.value)
        } else {
          hasCriticalFailure = true
        }

        if (logsResult.status === "fulfilled") {
          setAdminAuditLogs(logsResult.value.entries)
        } else {
          hasCriticalFailure = true
        }

        if (statusResult.status === "fulfilled") {
          setServiceStatus(statusResult.value)
        } else {
          setServiceStatus({ status: "offline" })
        }

        if (!silent && hasCriticalFailure) {
          toast({
            title: ta("opsLoadFailed"),
            description: ta("opsLoadFailedDescription"),
            color: "danger",
            variant: "flat",
          })
        }
      } finally {
        setLogsLoading(false)
      }
    },
    [hasAdminSession, isAdmin, ta, toast],
  )

  const loadAccessKeys = useCallback(
    async (silent = false) => {
      if (!hasAdminSession) {
        return
      }

      setAccessKeysLoading(true)
      try {
        const response = await fetchAdminAccessKeys(DEFAULT_PROVIDER_ID)
        setAdminAccessKeys(response.keys)
        setCopiedKeyId((current) =>
          current && response.keys.some((key) => key.id === current) ? current : null,
        )
      } catch (error) {
        if (!silent) {
          toast({
            title: ta("keyListLoadFailed"),
            description: getErrorDescription(error, ta("keyListLoadFailedDescription")),
            color: "danger",
            variant: "flat",
          })
        }
      } finally {
        setAccessKeysLoading(false)
      }
    },
    [hasAdminSession, ta, toast],
  )

  const loadInviteCodes = useCallback(
    async (silent = false) => {
      if (!hasAdminSession || !isAdmin) {
        return
      }

      setInviteCodesLoading(true)
      try {
        const response = await fetchAdminInviteCodes(DEFAULT_PROVIDER_ID)
        setAdminInviteCodes(
          [...response.codes].sort(
            (left, right) =>
              new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
          ),
        )
        setCopiedInviteCodeId((current) =>
          current && response.codes.some((code) => code.id === current) ? current : null,
        )
      } catch (error) {
        if (!silent) {
          toast({
            title: ta("inviteCodeLoadFailed"),
            description: getErrorDescription(error, ta("inviteCodeLoadFailedDescription")),
            color: "danger",
            variant: "flat",
          })
        }
      } finally {
        setInviteCodesLoading(false)
      }
    },
    [hasAdminSession, isAdmin, ta, toast],
  )

  const loadCloudflareSettings = useCallback(
    async (silent = false) => {
      if (!hasAdminSession) {
        return
      }

      try {
        applyCloudflareSettings(await fetchConsoleCloudflareSettings(DEFAULT_PROVIDER_ID))
      } catch (error) {
        if (!silent) {
          toast({
            title: ta("cloudflareLoadFailed"),
            description: getErrorDescription(error, ta("cloudflareLoadFailedDescription")),
            color: "danger",
            variant: "flat",
          })
        }
      }
    },
    [applyCloudflareSettings, hasAdminSession, ta, toast],
  )

  const syncMailboxAccountState = useCallback(
    (accounts: Account[]) => {
      const normalizedAccounts = sortMailboxAccounts(
        accounts
          .filter((account) => !account.isDeleted)
          .map((account) => ({
            ...account,
            password:
              storedMailboxAccounts.find((item) => item.id === account.id)?.password ||
              storedMailboxAccounts.find((item) => item.address === account.address)?.password,
            token:
              storedMailboxAccounts.find((item) => item.id === account.id)?.token ||
              storedMailboxAccounts.find((item) => item.address === account.address)?.token,
            providerId:
              account.providerId ||
              storedMailboxAccounts.find((item) => item.id === account.id)?.providerId ||
              storedMailboxAccounts.find((item) => item.address === account.address)?.providerId ||
              DEFAULT_PROVIDER_ID,
          })),
      )

      setMailboxAccounts(normalizedAccounts)

      if (normalizedAccounts.length === 0) {
        clearAccounts()
        setSelectedMessage(null)
        return normalizedAccounts
      }

      syncAccounts(normalizedAccounts)
      return normalizedAccounts
    },
    [clearAccounts, storedMailboxAccounts, syncAccounts],
  )

  const activateMailbox = useCallback(
    async (account: Account, silent = false) => {
      if (!hasAdminSession) {
        return false
      }

      setActivatingMailboxId(account.id)
      try {
        const providerId = account.providerId || DEFAULT_PROVIDER_ID
        let response: { token: string; id: string }

        try {
          response = await issueOwnedAccountToken(account.id, providerId)
        } catch (issueError) {
          if (!account.password) {
            throw issueError
          }

          response = await getToken(account.address, account.password, providerId)
        }

        activateAccount(
          {
            ...account,
            providerId,
          },
          response.token,
        )
        setSelectedMessage(null)

        if (!silent) {
          toast({
            title: ta("mailboxActivated"),
            description: account.address,
            color: "success",
            variant: "flat",
          })
        }
        return true
      } catch (error) {
        if (!silent) {
          toast({
            title: ta("mailboxAccessFailed"),
            description: getErrorDescription(error, ta("mailboxAccessFailedDescription")),
            color: "danger",
            variant: "flat",
          })
        }
        return false
      } finally {
        setActivatingMailboxId((current) => (current === account.id ? null : current))
      }
    },
    [activateAccount, hasAdminSession, ta, toast],
  )

  const loadMailboxAccounts = useCallback(
    async (silent = false, options?: { forceActivate?: boolean }) => {
      if (!hasAdminSession) {
        return
      }

      setMailboxAccountsLoading(true)
      try {
        const accounts = await fetchOwnedAccounts(DEFAULT_PROVIDER_ID)
        const normalizedAccounts = syncMailboxAccountState(accounts)
        const activeAccounts = normalizedAccounts.filter(
          (account) => !account.isDeleted && !account.isDisabled,
        )
        const preferredAccount =
          (currentMailboxAccountRef.current &&
            normalizedAccounts.find((account) => account.id === currentMailboxAccountRef.current?.id)) ||
          activeAccounts[0] ||
          normalizedAccounts[0]
        const shouldActivatePreferredAccount =
          Boolean(preferredAccount) &&
          (
            options?.forceActivate ||
            !mailboxTokenRef.current ||
            preferredAccount?.id !== currentMailboxAccountRef.current?.id ||
            !preferredAccount?.token
          )

        if (preferredAccount && shouldActivatePreferredAccount) {
          await activateMailbox(preferredAccount, true)
        }
      } catch (error) {
        if (!silent) {
          toast({
            title: ta("mailboxLoadFailed"),
            description: getErrorDescription(error, ta("mailboxLoadFailedDescription")),
            color: "danger",
            variant: "flat",
          })
        }
      } finally {
        setMailboxAccountsLoading(false)
      }
    },
    [
      activateMailbox,
      hasAdminSession,
      syncMailboxAccountState,
      ta,
      toast,
    ],
  )

  useEffect(() => {
    if (hasBootstrappedRef.current) {
      return
    }
    hasBootstrappedRef.current = true

    const bootstrap = async () => {
      setIsBootstrapping(true)

      syncRevealedAdminKeysFromStorage()

      if (requireSecureTransport && !isTrustedAdminContext()) {
        await clearAdminSession()
        return
      }

      try {
        const pendingSession = takePendingAdminSession<AdminSessionInfo>()
        if (pendingSession && isMountedRef.current) {
          applyAdminSession(pendingSession)
          setIsBootstrapping(false)
        }

        const session = await restoreAdminSessionInfo(DEFAULT_PROVIDER_ID)

        if (!isMountedRef.current) {
          return
        }

        applyAdminSession(session)
        setIsBootstrapping(false)

        setManagedDomainsLoading(true)
        void (async () => {
          try {
            const domains = await fetchManagedDomains(DEFAULT_PROVIDER_ID)
            if (!isMountedRef.current) {
              return
            }
            setManagedDomains(sortManagedDomains(domains))
          } catch (error) {
            if (!isMountedRef.current) {
              return
            }
            toast({
              title: ts("managedDomainsLoadFailed"),
              description: getErrorDescription(error, ts("managedDomainsLoadFailed")),
              color: "danger",
              variant: "flat",
            })
          } finally {
            if (isMountedRef.current) {
              setManagedDomainsLoading(false)
            }
          }
        })()

        void (async () => {
          try {
            const status = await fetchServiceStatus(DEFAULT_PROVIDER_ID)
            if (!isMountedRef.current) {
              return
            }
            setServiceStatus(status)
          } catch {}
        })()

        setMailboxAccountsLoading(true)
        void (async () => {
          try {
            const accounts = await fetchOwnedAccounts(DEFAULT_PROVIDER_ID)
            if (!isMountedRef.current) {
              return
            }

            const normalizedAccounts = syncMailboxAccountState(accounts)
            const activeAccounts = normalizedAccounts.filter(
              (account) => !account.isDeleted && !account.isDisabled,
            )
            const preferredAccount =
              (currentMailboxAccountRef.current &&
                normalizedAccounts.find(
                  (account) => account.id === currentMailboxAccountRef.current?.id,
                )) ||
              activeAccounts[0] ||
              normalizedAccounts[0]

            if (preferredAccount) {
              const providerId = preferredAccount.providerId || DEFAULT_PROVIDER_ID
              let issuedToken: string | null = null

              try {
                issuedToken = (
                  await issueOwnedAccountToken(preferredAccount.id, providerId)
                ).token
              } catch (issueError) {
                if (preferredAccount.password) {
                  issuedToken = (
                    await getToken(
                      preferredAccount.address,
                      preferredAccount.password,
                      providerId,
                    )
                  ).token
                } else {
                  void issueError
                }
              }

              if (issuedToken && isMountedRef.current) {
                activateAccount(
                  {
                    ...preferredAccount,
                    providerId,
                  },
                  issuedToken,
                )
                setSelectedMessage(null)
              }
            }
          } catch {} finally {
            if (isMountedRef.current) {
              setMailboxAccountsLoading(false)
            }
          }
        })()

        setAdminUsers([])
        setAdminInviteCodes([])
        setAdminMetrics(null)
        setAdminAuditLogs([])
        setPendingInviteCode(null)
      } catch (error) {
        toast({
          title: ta("sessionRestoreFailed"),
          description: getErrorDescription(error, ta("sessionRestoreFailed")),
          color: "danger",
          variant: "flat",
        })
        await clearAdminSession()
        return
      } finally {
        if (isMountedRef.current) {
          setIsBootstrapping(false)
        }
      }
    }

    void bootstrap()
  }, [
    activateAccount,
    applyAdminSession,
    clearAdminSession,
    entryPath,
    requireSecureTransport,
    syncMailboxAccountState,
    syncRevealedAdminKeysFromStorage,
    ta,
    ts,
    toast,
  ])

  useEffect(() => {
    if (!hasAdminSession || !isAdmin || !["overview", "logs"].includes(view)) {
      return
    }

    if (hasLoadedOpsRef.current) {
      return
    }

    hasLoadedOpsRef.current = true
    void loadOps(true)
  }, [hasAdminSession, isAdmin, loadOps, view])

  useEffect(() => {
    if (!hasAdminSession || !isAdmin || view !== "users") {
      return
    }

    if (hasLoadedUsersRef.current) {
      return
    }

    hasLoadedUsersRef.current = true
    void loadUsers(true)
  }, [hasAdminSession, isAdmin, loadUsers, view])

  useEffect(() => {
    if (!hasAdminSession || view !== "security") {
      return
    }

    if (hasLoadedAccessKeysRef.current) {
      return
    }

    hasLoadedAccessKeysRef.current = true
    void loadAccessKeys(true)
  }, [hasAdminSession, loadAccessKeys, view])

  useEffect(() => {
    if (!hasAdminSession || !isAdmin || view !== "settings") {
      return
    }

    if (hasLoadedInviteCodesRef.current) {
      return
    }

    hasLoadedInviteCodesRef.current = true
    void loadInviteCodes(true)
  }, [hasAdminSession, isAdmin, loadInviteCodes, view])

  useEffect(() => {
    if (!hasAdminSession || view !== "settings") {
      return
    }

    if (hasLoadedCloudflareSettingsRef.current) {
      return
    }

    hasLoadedCloudflareSettingsRef.current = true
    void loadCloudflareSettings(true)
  }, [hasAdminSession, loadCloudflareSettings, view])

  const handleCopyAdminKey = async (key: AdminAccessKey) => {
    const apiKey = getVisibleAdminKeyValue(key)
    if (!apiKey) {
      toast({
        title: ta("keyCopyUnavailable"),
        description: ta("keyCopyUnavailableDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    try {
      await copyTextToClipboard(apiKey)
      setCopiedKeyId(key.id)
      window.setTimeout(() => {
        setCopiedKeyId((current) => (current === key.id ? null : current))
      }, 1_500)
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

  const handleGenerateAdminKey = async () => {
    if (!hasAdminSession || isCreatingAccessKey || isBootstrapping || accessKeysLoading) {
      return
    }

    setIsCreatingAccessKey(true)
    try {
      const response = await createAdminAccessKey(
        {
          name: newAccessKeyName.trim() || undefined,
        },
        DEFAULT_PROVIDER_ID,
      )
      const expiresAt = Date.now() + ADMIN_KEY_VISIBLE_MS
      setRevealedAdminKeys((current) => ({
        ...current,
        [response.key.id]: {
          apiKey: response.apiKey,
          expiresAt,
        },
      }))
      storeRevealedAdminKey(response.key.id, response.apiKey, ADMIN_KEY_VISIBLE_MS)
      setAdminAccessKeys((current) =>
        [response.key, ...current.filter((item) => item.id !== response.key.id)]
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
      )
      setNewAccessKeyName("")
      void loadAccessKeys(true)
      toast({
        title: ta("keyCreated"),
        description: ta("keyCreatedDescription", { name: response.key.name }),
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("keyCreateFailed"),
        description: getErrorDescription(error, ta("keyCreateFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsCreatingAccessKey(false)
    }
  }

  const handleDeleteAccessKey = async (key: AdminAccessKey) => {
    const confirmed = await requestConfirmation({
      title: ta("deleteKey"),
      description: ta("keyDeleteConfirm", { name: key.name }),
      confirmLabel: tc("delete"),
      tone: "danger",
    })
    if (!confirmed) {
      return
    }

    setDeletingAccessKeyId(key.id)
    try {
      await deleteAdminAccessKey(key.id, DEFAULT_PROVIDER_ID)
      setAdminAccessKeys((current) => current.filter((item) => item.id !== key.id))
      setRevealedAdminKeys((current) => {
        if (!(key.id in current)) {
          return current
        }

        const next = { ...current }
        delete next[key.id]
        return next
      })
      if (
        pendingRevealedAdminKey?.apiKey &&
        matchesMaskedAdminKey(pendingRevealedAdminKey.apiKey, key.maskedKey)
      ) {
        clearStoredPendingRevealedAdminKey()
        setPendingRevealedAdminKey(null)
      }
      clearStoredRevealedAdminKey(key.id)
      setCopiedKeyId((current) => (current === key.id ? null : current))
      toast({
        title: ta("keyDeleted"),
        description: key.name,
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("keyDeleteFailed"),
        description: getErrorDescription(error, ta("keyDeleteFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setDeletingAccessKeyId(null)
    }
  }

  const handleCopyInviteCode = async (code: { id: string; inviteCode: string }) => {
    try {
      await copyTextToClipboard(code.inviteCode)
      setCopiedInviteCodeId(code.id)
      window.setTimeout(() => {
        setCopiedInviteCodeId((current) => (current === code.id ? null : current))
      }, 1_500)
      toast({
        title: ta("inviteCodeCopied"),
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

  const handleCreateInviteCode = async () => {
    if (!hasAdminSession || !isAdmin || isCreatingInviteCode || inviteCodesLoading) {
      return
    }

    const trimmedMaxUses = newInviteCodeMaxUses.trim()
    let parsedMaxUses: number | undefined
    if (trimmedMaxUses) {
      const candidateMaxUses = Number(trimmedMaxUses)
      if (
        !Number.isFinite(candidateMaxUses) ||
        candidateMaxUses < 1 ||
        !Number.isInteger(candidateMaxUses)
      ) {
        toast({
          title: ta("inviteCodeCreateInvalid"),
          description: ta("inviteCodeMaxUsesInvalid"),
          color: "warning",
          variant: "flat",
        })
        return
      }
      parsedMaxUses = candidateMaxUses
    }

    setIsCreatingInviteCode(true)
    try {
      const response = await createAdminInviteCode(
        {
          name: newInviteCodeName.trim() || undefined,
          maxUses: parsedMaxUses,
        },
        DEFAULT_PROVIDER_ID,
      )
      setPendingInviteCode(response)
      setAdminInviteCodes((current) =>
        [response.code, ...current.filter((item) => item.id !== response.code.id)].sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
        ),
      )
      setNewInviteCodeName("")
      setNewInviteCodeMaxUses("")
      toast({
        title: ta("inviteCodeCreated"),
        description: ta("inviteCodeCreatedDescription", { name: response.code.name }),
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("inviteCodeCreateFailed"),
        description: getErrorDescription(error, ta("inviteCodeCreateFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsCreatingInviteCode(false)
    }
  }

  const handleToggleInviteCodeDisabled = async (code: AdminInviteCode) => {
    if (!hasAdminSession || !isAdmin) {
      return
    }

    setUpdatingInviteCodeId(code.id)
    try {
      const updated = await updateAdminInviteCode(
        code.id,
        { isDisabled: !code.isDisabled },
        DEFAULT_PROVIDER_ID,
      )
      setAdminInviteCodes((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      )
      setPendingInviteCode((current) =>
        current && current.code.id === updated.id
          ? { ...current, code: updated }
          : current,
      )
      toast({
        title: updated.isDisabled ? ta("inviteCodeDisabled") : ta("inviteCodeEnabled"),
        description: updated.name,
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("inviteCodeUpdateFailed"),
        description: getErrorDescription(error, ta("inviteCodeUpdateFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setUpdatingInviteCodeId(null)
    }
  }

  const handleDeleteInviteCode = async (code: AdminInviteCode) => {
    const confirmed = await requestConfirmation({
      title: code.name,
      description: ta("inviteCodeDeleteConfirm", { name: code.name }),
      confirmLabel: tc("delete"),
      tone: "danger",
    })
    if (!confirmed) {
      return
    }

    setDeletingInviteCodeId(code.id)
    try {
      await deleteAdminInviteCode(code.id, DEFAULT_PROVIDER_ID)
      setAdminInviteCodes((current) => current.filter((item) => item.id !== code.id))
      setPendingInviteCode((current) =>
        current?.code.id === code.id ? null : current,
      )
      setCopiedInviteCodeId((current) => (current === code.id ? null : current))
      toast({
        title: ta("inviteCodeDeleted"),
        description: code.name,
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("inviteCodeDeleteFailed"),
        description: getErrorDescription(error, ta("inviteCodeDeleteFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setDeletingInviteCodeId(null)
    }
  }

  const handleUpdatePassword = async () => {
    if (!hasAdminSession) {
      return
    }

    if (!currentPassword.trim() || !nextPassword.trim()) {
      toast({ title: ta("changePasswordRequired"), color: "warning", variant: "flat" })
      return
    }

    if (nextPassword.trim().length < 10) {
      toast({ title: ta("passwordTooShort"), color: "warning", variant: "flat" })
      return
    }

    setIsUpdatingPassword(true)
    try {
      await updateAdminPassword(currentPassword, nextPassword, DEFAULT_PROVIDER_ID)
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

  const handleCreateMailbox = async () => {
    if (!hasAdminSession) {
      return
    }

    const mailboxLocalPart = mailboxLocalPartInput.trim()
    if (!mailboxLocalPart || !mailboxDomainInput) {
      toast({
        title: ta("mailboxCreateRequired"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (mailboxLocalPart.includes("@")) {
      toast({
        title: ta("mailboxCreateLocalPartInvalid"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    const mailboxAddress = `${mailboxLocalPart}@${mailboxDomainInput}`

    setIsCreatingMailbox(true)
    try {
      const createdAccount = await createOwnedAccount(
        mailboxAddress,
        DEFAULT_PROVIDER_ID,
      )
      const normalizedAccount: Account = {
        ...createdAccount,
        providerId: DEFAULT_PROVIDER_ID,
      }
      const nextAccounts = sortMailboxAccounts([
        normalizedAccount,
        ...mailboxAccounts.filter((account) => account.id !== normalizedAccount.id),
      ])
      setMailboxAccounts(nextAccounts)
      syncAccounts(nextAccounts)
      setMailboxLocalPartInput("")
      const activated = await activateMailbox(normalizedAccount, true)
      toast(
        activated
          ? {
              title: ta("mailboxCreated"),
              description: normalizedAccount.address,
              color: "success",
              variant: "flat",
            }
          : {
              title: ta("mailboxCreateAutoOpenFailed"),
              description: ta("mailboxCreateAutoOpenFailedDescription"),
              color: "warning",
              variant: "flat",
            },
      )
    } catch (error) {
      toast({
        title: ta("mailboxCreateFailed"),
        description: getErrorDescription(error, ta("mailboxCreateFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsCreatingMailbox(false)
    }
  }

  const handleDeleteMailbox = async (account: Account) => {
    const confirmed = await requestConfirmation({
      title: account.address,
      description: ta("mailboxDeleteConfirm", { address: account.address }),
      confirmLabel: tc("delete"),
      tone: "danger",
    })
    if (!confirmed) {
      return
    }

    const applyDeletedMailboxState = async () => {
      const nextAccounts = mailboxAccounts.filter((item) => item.id !== account.id)
      setMailboxAccounts(nextAccounts)
      syncAccounts(nextAccounts)
      if (currentAccount?.id === account.id) {
        setSelectedMessage(null)
      }
      if (nextAccounts.length === 0) {
        clearAccounts()
      } else if (currentAccount?.id === account.id) {
        await activateMailbox(nextAccounts[0], true)
      }
      void loadMailboxAccounts(true)
    }

    setDeletingMailboxId(account.id)
    try {
      await deleteOwnedAccount(account.id, DEFAULT_PROVIDER_ID)
      await applyDeletedMailboxState()
      toast({
        title: ta("mailboxDeleted"),
        description: account.address,
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes("HTTP 404")) {
        await applyDeletedMailboxState()
        toast({
          title: ta("mailboxDeleted"),
          description: account.address,
          color: "success",
          variant: "flat",
        })
        return
      }

      toast({
        title: ta("mailboxDeleteFailed"),
        description: getErrorDescription(error, ta("mailboxDeleteFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setDeletingMailboxId(null)
    }
  }

  const handleCreateDomain = async () => {
    if (!hasAdminSession) {
      return
    }

    const normalizedDomain = normalizeManagedDomainEntry(managedDomainInput)
    if (!normalizedDomain) {
      toast({ title: ts("domainInputRequired"), color: "warning", variant: "flat" })
      return
    }

    setIsCreatingDomain(true)
    try {
      const shouldAutoSyncDomains =
        cloudflareSettings.enabled &&
        cloudflareSettings.apiTokenConfigured &&
        cloudflareSettings.autoSyncEnabled

      const createdDomain = await createManagedDomain(normalizedDomain, DEFAULT_PROVIDER_ID)
      setManagedDomains((current) =>
        sortManagedDomains([createdDomain, ...current.filter((item) => item.id !== createdDomain.id)]),
      )
      setManagedDomainInput("")
      if (shouldAutoSyncDomains) {
        const syncResult = await runCloudflareDomainSync(createdDomain, {
          silentSuccess: true,
          silentError: true,
        })
        toast(
          syncResult
            ? {
                title: ts("domainAdded"),
                description: ta("cloudflareSyncSuccessDescription", {
                  zone: syncResult.zoneName,
                  created: syncResult.createdRecords,
                  updated: syncResult.updatedRecords,
                  unchanged: syncResult.unchangedRecords,
                }),
                color: "success",
                variant: "flat",
              }
            : {
                title: ts("domainAdded"),
                description: ta("cloudflareSyncDeferredDescription"),
                color: "warning",
                variant: "flat",
              },
        )
      } else {
        toast({
          title: ts("domainAdded"),
          description: ts("dnsRecordsReady"),
          color: "success",
          variant: "flat",
        })
      }
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

  const loadBatchCloudflareZones = useCallback(
    async (settingsOverride?: ConsoleCloudflareSettings) => {
      const requestId = batchCloudflareZoneRequestIdRef.current + 1
      batchCloudflareZoneRequestIdRef.current = requestId
      setCloudflareZoneLoadError(null)
      setCloudflareZonesLoading(true)

      let effectiveSettings = normalizeCloudflareSettings(
        settingsOverride ?? cloudflareSettingsRef.current,
      )

      try {
        if (!settingsOverride) {
          effectiveSettings = normalizeCloudflareSettings(
            await withTimeout(
              fetchConsoleCloudflareSettings(DEFAULT_PROVIDER_ID),
              BATCH_CLOUDFLARE_ZONE_LOAD_TIMEOUT_MS,
              ts("cloudflareZoneLoadTimeoutDesc"),
            ),
          )

          if (batchCloudflareZoneRequestIdRef.current !== requestId) {
            return []
          }

          applyCloudflareSettings(effectiveSettings)
        }

        if (!effectiveSettings.apiTokenConfigured) {
          if (batchCloudflareZoneRequestIdRef.current === requestId) {
            setCloudflareZoneOptions([])
            setCloudflareZonesRequireApiUpdate(false)
          }
          return []
        }

        const response = await withTimeout(
          testConsoleCloudflareToken(undefined, DEFAULT_PROVIDER_ID),
          BATCH_CLOUDFLARE_ZONE_LOAD_TIMEOUT_MS,
          ts("cloudflareZoneLoadTimeoutDesc"),
        )
        const zones = Array.from(
          new Set(
            (response.zones ?? [])
              .map(normalizeManagedDomainEntry)
              .filter(Boolean),
          ),
        ).sort((left, right) => left.localeCompare(right))
        const requiresApiUpdate = response.zoneCount > 0 && zones.length === 0
        if (batchCloudflareZoneRequestIdRef.current !== requestId) {
          return zones
        }

        setCloudflareZonesRequireApiUpdate(requiresApiUpdate)
        setCloudflareZoneOptions(zones)
        if (requiresApiUpdate) {
          toast({
            title: ts("cloudflareZoneApiOutdated"),
            description: ts("cloudflareZoneApiOutdatedDesc"),
            color: "warning",
            variant: "flat",
          })
        }
        return zones
      } catch (error) {
        if (batchCloudflareZoneRequestIdRef.current === requestId) {
          setCloudflareZoneOptions([])
          setCloudflareZonesRequireApiUpdate(false)
          setCloudflareZoneLoadError(getErrorDescription(error, ts("cloudflareZoneLoadFailedDesc")))
        }
        return []
      } finally {
        if (batchCloudflareZoneRequestIdRef.current === requestId) {
          setCloudflareZonesLoading(false)
        }
      }
    },
    [applyCloudflareSettings, toast, ts],
  )

  const handleOpenBatchDomainModal = useCallback(() => {
    setCloudflareZoneOptions([])
    setCloudflareZonesRequireApiUpdate(false)
    setCloudflareZoneLoadError(null)
    setCloudflareZonesLoading(false)
    setBatchDomainProgress(null)
    setIsBatchDomainModalOpen(true)
  }, [])

  const handleCloseBatchDomainModal = useCallback(() => {
    if (isCreatingDomainBatch) {
      return
    }

    batchCloudflareZoneRequestIdRef.current += 1
    setCloudflareZonesLoading(false)
    setCloudflareZoneLoadError(null)
    setBatchDomainProgress(null)
    setIsBatchDomainModalOpen(false)
  }, [isCreatingDomainBatch])

  useEffect(() => {
    if (!isBatchDomainModalOpen) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        await loadBatchCloudflareZones()
      } finally {
        if (cancelled) {
          batchCloudflareZoneRequestIdRef.current += 1
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    isBatchDomainModalOpen,
    loadBatchCloudflareZones,
  ])

  const handleCreateRandomDomainBatch = async () => {
    if (!hasAdminSession) {
      return
    }

    const normalizedRootDomain = normalizeManagedDomainEntry(batchDomainRootInput)
    if (!normalizedRootDomain) {
      toast({
        title: ts("domainBatchRootRequired"),
        description: ts("domainBatchRootRequiredDesc"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (normalizedRootDomain.split(".").filter(Boolean).length < 2) {
      toast({
        title: ts("domainBatchRootInvalid"),
        description: ts("domainBatchRootInvalidDesc"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (!canBatchCreateManagedDomains) {
      toast({
        title: ts("domainBatchRequiresCloudflare"),
        description: ts("domainBatchRequiresCloudflareDesc"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    const normalizedPrefix = normalizeManagedDomainPrefix(batchDomainPrefixInput)
    if (!normalizedPrefix) {
      toast({
        title: ts("domainBatchPrefixRequired"),
        description: ts("domainBatchPrefixRequiredDesc"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (
      normalizedPrefix.length > MAX_BATCH_DOMAIN_PREFIX_LENGTH ||
      !isValidManagedDomainPrefix(normalizedPrefix)
    ) {
      toast({
        title: ts("domainBatchPrefixInvalid"),
        description: ts("domainBatchPrefixInvalidDesc", {
          count: MAX_BATCH_DOMAIN_PREFIX_LENGTH,
        }),
        color: "warning",
        variant: "flat",
      })
      return
    }

    const rawRandomLength = Number(batchDomainRandomLengthInput)
    if (
      !Number.isInteger(rawRandomLength) ||
      rawRandomLength < MIN_BATCH_DOMAIN_RANDOM_LENGTH ||
      rawRandomLength > MAX_BATCH_DOMAIN_RANDOM_LENGTH
    ) {
      toast({
        title: ts("domainBatchRandomLengthInvalid"),
        description: ts("domainBatchRandomLengthInvalidDesc", {
          min: MIN_BATCH_DOMAIN_RANDOM_LENGTH,
          max: MAX_BATCH_DOMAIN_RANDOM_LENGTH,
        }),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (normalizedPrefix.length + 1 + rawRandomLength > 63) {
      toast({
        title: ts("domainBatchPrefixTooLong"),
        description: ts("domainBatchPrefixTooLongDesc"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    const rawRequestedCount = Number(batchDomainCountInput)
    if (!Number.isInteger(rawRequestedCount) || rawRequestedCount <= 0) {
      toast({
        title: ts("domainBatchCountInvalid"),
        description: ts("domainBatchCountInvalidDesc"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (rawRequestedCount > MAX_BATCH_MANAGED_DOMAINS) {
      toast({
        title: ts("domainBatchLimitExceeded"),
        description: ts("domainBatchLimitExceededDesc", {
          count: MAX_BATCH_MANAGED_DOMAINS,
        }),
        color: "warning",
        variant: "flat",
      })
      return
    }

    const requestedCount = rawRequestedCount

    if (!isAdmin && sessionInfo) {
      const remainingDomainSlots = Math.max(sessionInfo.user.domainLimit - ownedManagedDomainsCount, 0)
      if (requestedCount > remainingDomainSlots) {
        toast({
          title: ts("domainBatchLimitReached"),
          description: ts("domainBatchLimitReachedDesc", { remaining: remainingDomainSlots }),
          color: "warning",
          variant: "flat",
        })
        return
      }
    }

    const existingDomains = new Set(managedDomains.map((domain) => domain.domain.toLowerCase()))
    const generatedDomains = buildRandomManagedDomains(
      normalizedRootDomain,
      normalizedPrefix,
      rawRandomLength,
      requestedCount,
      existingDomains,
    )

    if (generatedDomains.length !== requestedCount) {
      toast({
        title: ts("domainBatchGenerateFailed"),
        description: ts("domainBatchGenerateFailedDesc"),
        color: "danger",
        variant: "flat",
      })
      return
    }

    setIsCreatingDomainBatch(true)
    setBatchDomainProgress({
      total: requestedCount,
      completed: 0,
      created: 0,
      synced: 0,
      failed: 0,
      currentDomain: generatedDomains[0] ?? "",
    })
    try {
      const createdDomains: Domain[] = []
      const failedDomains: Array<{ domain: string; reason: string }> = []
      let cloudflareSyncedCount = 0

      for (const [index, domain] of generatedDomains.entries()) {
        setBatchDomainProgress((current) =>
          current
            ? {
                ...current,
                currentDomain: domain,
              }
            : current,
        )

        try {
          const createdDomain = await createManagedDomain(domain, DEFAULT_PROVIDER_ID)
          setBatchDomainProgress((current) =>
            current
              ? {
                  ...current,
                  created: current.created + 1,
                }
              : current,
          )

          const syncResult = await runCloudflareDomainSync(createdDomain, {
            silentSuccess: true,
            silentError: true,
          })
          createdDomains.push(syncResult?.domain ?? createdDomain)
          if (syncResult) {
            cloudflareSyncedCount += 1
            setBatchDomainProgress((current) =>
              current
                ? {
                    ...current,
                    synced: current.synced + 1,
                  }
                : current,
            )
          }
        } catch (error) {
          failedDomains.push({
            domain,
            reason: getErrorDescription(error, ts("domainAddFailed")),
          })
          setBatchDomainProgress((current) =>
            current
              ? {
                  ...current,
                  failed: current.failed + 1,
                }
              : current,
          )
        } finally {
          const nextDomain = generatedDomains[index + 1] ?? ""
          setBatchDomainProgress((current) =>
            current
              ? {
                  ...current,
                  completed: current.completed + 1,
                  currentDomain: nextDomain,
                }
              : current,
          )
        }
      }

      if (createdDomains.length > 0) {
        const createdDomainNames = new Set(createdDomains.map((domain) => domain.domain.toLowerCase()))
        setManagedDomains((current) =>
          sortManagedDomains([
            ...createdDomains,
            ...current.filter((domain) => !createdDomainNames.has(domain.domain.toLowerCase())),
          ]),
        )
      }

      if (createdDomains.length === 0) {
        toast({
          title: ts("domainBatchFailed"),
          description: failedDomains[0]?.reason ?? ts("domainAddFailed"),
          color: "danger",
          variant: "flat",
        })
        return
      }

      toast({
        title: ts("domainBatchCreated"),
        description: ts("domainBatchCreatedWithSyncDescription", {
          created: createdDomains.length,
          synced: cloudflareSyncedCount,
          pending: createdDomains.length - cloudflareSyncedCount,
          skipped: 0,
          failed: failedDomains.length,
        }),
        color:
          failedDomains.length > 0 || cloudflareSyncedCount < createdDomains.length
            ? "warning"
            : "success",
        variant: "flat",
      })
      setIsBatchDomainModalOpen(false)
    } finally {
      setIsCreatingDomainBatch(false)
      setBatchDomainProgress(null)
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
        const records = await getManagedDomainRecords(domainId, DEFAULT_PROVIDER_ID)
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
      const updatedDomain = await verifyManagedDomain(domainId, DEFAULT_PROVIDER_ID)
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

  const handleToggleDomainSharing = async (domain: Domain) => {
    setSharingDomainId(domain.id)
    try {
      const updatedDomain = await updateManagedDomainSharing(
        domain.id,
        !domain.isShared,
        DEFAULT_PROVIDER_ID,
      )
      setManagedDomains((current) =>
        sortManagedDomains(
          current.map((item) => (item.id === domain.id ? { ...item, ...updatedDomain } : item)),
        ),
      )
      toast({
        title: updatedDomain.isShared ? ts("domainShareEnabled") : ts("domainShareDisabled"),
        description: updatedDomain.domain,
        color: updatedDomain.isShared ? "success" : "warning",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ts("domainShareUpdateFailed"),
        description: getErrorDescription(error, ts("domainShareUpdateFailedDesc")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setSharingDomainId(null)
    }
  }

  const handleDeleteDomain = async (domain: Domain) => {
    const confirmed = await requestConfirmation({
      title: domain.domain,
      description: ts("domainDeleteConfirm", { domain: domain.domain }),
      confirmLabel: tc("delete"),
      tone: "danger",
    })
    if (!confirmed) {
      return
    }

    setDeletingDomainId(domain.id)
    try {
      await deleteManagedDomain(domain.id, DEFAULT_PROVIDER_ID)
      setManagedDomains((current) => current.filter((item) => item.id !== domain.id))
      const nextAccounts = mailboxAccounts.filter(
        (account) => mailboxDomain(account.address) !== domain.domain.toLowerCase(),
      )
      setMailboxAccounts(nextAccounts)
      syncAccounts(nextAccounts)
      if (currentAccount && mailboxDomain(currentAccount.address) === domain.domain.toLowerCase()) {
        setSelectedMessage(null)
        if (nextAccounts.length === 0) {
          clearAccounts()
        } else {
          void activateMailbox(nextAccounts[0], true)
        }
      }
      void loadMailboxAccounts(true)
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
    if (!hasAdminSession || !isAdmin) {
      return
    }

    const parsedDomainLimit = Number(newUserDomainLimit)
    if (
      !newUsername.trim() ||
      !newUserPassword.trim() ||
      !Number.isFinite(parsedDomainLimit) ||
      parsedDomainLimit < 0
    ) {
      toast({
        title: ta("userCreateInvalid"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    setIsCreatingUser(true)
    try {
      const createdUser = await createAdminUser(
        {
          username: newUsername.trim(),
          password: newUserPassword,
          role: "user",
          domainLimit: Math.round(parsedDomainLimit),
        },
        DEFAULT_PROVIDER_ID,
      )
      setAdminUsers((current) =>
        [...current, createdUser].sort((left, right) => left.username.localeCompare(right.username)),
      )
      setNewUsername("")
      setNewUserPassword("")
      setNewUserDomainLimit("3")
      toast({
        title: ta("userCreated"),
        description: createdUser.username,
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
      setIsCreatingUser(false)
    }
  }

  const handlePatchUser = async (user: ConsoleUser, patch: Partial<ConsoleUser>) => {
    if (!hasAdminSession) {
      return
    }

    try {
      const updated = await updateAdminUser(
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
    const confirmed = await requestConfirmation({
      title: user.username,
      description: ta("userDeleteConfirm", { username: user.username }),
      confirmLabel: tc("delete"),
      tone: "danger",
    })
    if (!confirmed) {
      return
    }

    try {
      await deleteAdminUser(user.id, DEFAULT_PROVIDER_ID)
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
    const nextPassword = await requestInputValue({
      title: ta("resetUserPassword"),
      description: ta("userResetPasswordPrompt", { username: user.username }),
      inputLabel: tc("password"),
      inputType: "password",
      confirmLabel: tc("save"),
      tone: "primary",
      value: "",
      validate: (value) => {
        if (!value.trim()) {
          return tc("required")
        }

        if (value.trim().length < 10) {
          return ta("passwordTooShort")
        }

        return null
      },
    })
    if (!nextPassword?.trim()) {
      return
    }

    try {
      await resetAdminUserPassword(
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
    const nextValue = await requestInputValue({
      title: ta("editDomainLimit"),
      description: ta("userDomainLimitPrompt", { username: user.username }),
      inputLabel: ta("domainLimitLabel"),
      inputType: "number",
      inputMode: "numeric",
      confirmLabel: tc("save"),
      tone: "primary",
      value: String(user.domainLimit),
      validate: (value) => {
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed < 0) {
          return ta("userLimitInvalid")
        }

        return null
      },
    })
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

  const updateAllowedEmailSuffixesDraft = useCallback((nextAllowedSuffixes: string[]) => {
    setSettingsDraft((current) => ({
      ...current,
      registrationSettings: {
        ...current.registrationSettings,
        allowedEmailSuffixes: Array.from(
          new Set(nextAllowedSuffixes.map(normalizeManagedDomainEntry).filter(Boolean)),
        ).sort((left, right) => left.localeCompare(right)),
      },
    }))
  }, [])

  const saveSettings = async (payload: AdminUpdateSystemSettingsRequest) => {
    if (!hasAdminSession || !isAdmin) {
      return null
    }

    await updateAdminSystemSettings(payload, DEFAULT_PROVIDER_ID)
    const session = await getAdminSessionInfo(DEFAULT_PROVIDER_ID)
    applySavedSettings(session.systemSettings)
    setSessionInfo((current) => ({
      ...(current ?? session),
      ...session,
      systemSettings: normalizeSettings(session.systemSettings),
    }))
    void loadOps(true)
    return session.systemSettings
  }

  const handleToggleSystemEnabled = async (nextEnabled: boolean) => {
    if (!hasAdminSession || !isAdmin || isUpdatingSystemEnabled) {
      return
    }

    const previousEnabled = settingsDraft.systemEnabled
    setSettingsDraft((current) => ({ ...current, systemEnabled: nextEnabled }))
    setIsUpdatingSystemEnabled(true)

    try {
      await saveSettings({ systemEnabled: nextEnabled })
      toast({
        title: ta("settingsSaved"),
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      setSettingsDraft((current) => ({ ...current, systemEnabled: previousEnabled }))
      toast({
        title: ta("settingsSaveFailed"),
        description: getErrorDescription(error, ta("settingsSaveFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsUpdatingSystemEnabled(false)
    }
  }

  const handleSaveSettings = async () => {
    if (!hasAdminSession || !isAdmin) {
      return
    }

    const payload = buildSettingsSavePayload(normalizedSettingsDraft, savedSettings)
    if (Object.keys(payload).length === 0) {
      return
    }

    setSettingsSaving(true)
    try {
      await saveSettings(payload)
      toast({
        title: ta("settingsSaved"),
        color: "success",
        variant: "flat",
      })
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

  const runCloudflareDomainSync = useCallback(
    async (domain: Domain, options?: { silentSuccess?: boolean; silentError?: boolean }) => {
      if (!hasAdminSession) {
        return null
      }

      setCloudflareSyncingDomainId(domain.id)
      try {
        const response = await syncManagedDomainCloudflare(domain.id, DEFAULT_PROVIDER_ID)
        if (response.domain) {
          setManagedDomains((current) =>
            sortManagedDomains(
              current.map((item) => (item.id === response.domain?.id ? response.domain : item)),
            ),
          )
        }
        if (!options?.silentSuccess) {
          toast({
            title: ta("cloudflareSyncSuccess"),
            description: ta("cloudflareSyncSuccessDescription", {
              zone: response.zoneName,
              created: response.createdRecords,
              updated: response.updatedRecords,
              unchanged: response.unchangedRecords,
            }),
            color: "success",
            variant: "flat",
          })
        }
        return response
      } catch (error) {
        if (!options?.silentError) {
          toast({
            title: ta("cloudflareSyncFailed"),
            description: getErrorDescription(error, ta("cloudflareSyncFailedDescription")),
            color: "warning",
            variant: "flat",
          })
        }
        return null
      } finally {
        setCloudflareSyncingDomainId((current) => (current === domain.id ? null : current))
      }
    },
    [hasAdminSession, ta, toast],
  )

  const handleSaveCloudflareSettings = async () => {
    if (!hasAdminSession) {
      return
    }

    if (
      cloudflareSettings.enabled &&
      !cloudflareSettings.apiTokenConfigured &&
      !cloudflareApiTokenInput.trim()
    ) {
      toast({
        title: ta("cloudflareTokenRequired"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    setCloudflareSaving(true)
    try {
      applyCloudflareSettings(
        await updateConsoleCloudflareSettings(
          {
            enabled: cloudflareSettings.enabled,
            apiToken: cloudflareApiTokenInput.trim() || undefined,
            autoSyncEnabled: cloudflareSettings.autoSyncEnabled,
          },
          DEFAULT_PROVIDER_ID,
        ),
      )
      toast({
        title: ta("cloudflareSaved"),
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("cloudflareSaveFailed"),
        description: getErrorDescription(error, ta("cloudflareSaveFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setCloudflareSaving(false)
    }
  }

  const handleTestCloudflareToken = async () => {
    if (!hasAdminSession) {
      return
    }

    if (!cloudflareApiTokenInput.trim() && !cloudflareSettings.apiTokenConfigured) {
      toast({
        title: ta("cloudflareTokenRequired"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    setCloudflareTesting(true)
    try {
      const response = await testConsoleCloudflareToken(
        cloudflareApiTokenInput.trim() || undefined,
        DEFAULT_PROVIDER_ID,
      )
      toast({
        title:
          response.zoneCount > 0 ? ta("cloudflareTestSuccess") : ta("cloudflareTestNoZones"),
        description:
          response.zoneCount > 0
            ? ta("cloudflareTestSuccessDescription", { count: response.zoneCount })
            : ta("cloudflareTestNoZonesDescription"),
        color: response.zoneCount > 0 ? "success" : "warning",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("cloudflareTestFailed"),
        description: getErrorDescription(error, ta("cloudflareTestFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setCloudflareTesting(false)
    }
  }

  const handleRunCleanup = async () => {
    if (!hasAdminSession) {
      return
    }

    setIsRunningCleanup(true)
    try {
      const report = await runAdminCleanup(DEFAULT_PROVIDER_ID)
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

  const handleClearAuditLogs = async () => {
    if (!hasAdminSession || !isAdmin || isClearingLogs || adminAuditLogs.length === 0) {
      return
    }

    setIsClearingLogs(true)
    try {
      await clearAdminAuditLogs(DEFAULT_PROVIDER_ID)
      await loadOps(true)
      toast({
        title: ta("clearLogsCompleted"),
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("clearLogsFailed"),
        description: getErrorDescription(error, ta("clearLogsFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsClearingLogs(false)
    }
  }

  const menuItems = [
    { id: "mailboxes" as const, label: ta("menuMailboxes"), icon: Inbox },
    ...(isAdmin ? [{ id: "overview" as const, label: ta("menuOverview"), icon: Server }] : []),
    { id: "domains" as const, label: ta("menuDomains"), icon: Globe2 },
    ...(isAdmin ? [{ id: "users" as const, label: ta("menuUsers"), icon: Users2 }] : []),
    { id: "security" as const, label: ta("menuSecurity"), icon: KeyRound },
    ...(isAdmin ? [{ id: "logs" as const, label: ta("menuLogs"), icon: ReceiptText }] : []),
    { id: "settings" as const, label: ta("menuSettings"), icon: SlidersHorizontal },
  ]
  const settingsSections = useMemo(
    () =>
      isAdmin
        ? [
            { id: "core" as const, label: ta("settingsTabCore") },
            { id: "registration" as const, label: ta("settingsTabRegistration") },
            { id: "limits" as const, label: ta("settingsTabLimits") },
            { id: "integrations" as const, label: ta("settingsTabIntegrations") },
            { id: "cloudflare" as const, label: ta("settingsTabCloudflare") },
          ]
        : [{ id: "cloudflare" as const, label: ta("settingsTabCloudflare") }],
    [isAdmin, ta],
  )
  const currentMenuItem = menuItems.find((item) => item.id === view) ?? menuItems[0]
  const isCloudflareSection = settingsSection === "cloudflare"
  const canRunCloudflareSync =
    cloudflareSettings.enabled && cloudflareSettings.apiTokenConfigured
  const canBatchCreateManagedDomains = canRunCloudflareSync
  const savedSettings = useMemo(
    () => normalizeSettings(sessionInfo?.systemSettings ?? DEFAULT_SETTINGS),
    [normalizeSettings, sessionInfo?.systemSettings],
  )
  const normalizedSettingsDraft = useMemo(
    () => normalizeSettings(settingsDraft),
    [normalizeSettings, settingsDraft],
  )
  const draftBranding = useMemo(
    () => resolveSiteBranding(normalizedSettingsDraft.branding),
    [normalizedSettingsDraft.branding],
  )
  const emailOtpDefaultSubject = useMemo(
    () => replaceBrandNameText(ta("emailOtpDefaultSubject"), draftBranding.brandName),
    [draftBranding.brandName, ta],
  )
  const emailOtpDefaultBody = useMemo(
    () =>
      replaceBrandNameText(
        ta("emailOtpDefaultBody", {
          code: "{{code}}",
          ttlSeconds: "{{ttlSeconds}}",
        }),
        draftBranding.brandName,
      ),
    [draftBranding.brandName, ta],
  )
  const normalizedCloudflareSettings = useMemo(
    () => normalizeCloudflareSettings(cloudflareSettings),
    [cloudflareSettings],
  )
  const linuxDoCallbackPath = "/auth/linux-do"
  const linuxDoCallbackUrl =
    settingsDraft.registrationSettings.linuxDo.callbackUrl?.trim() ||
    (browserOrigin
      ? new URL(linuxDoCallbackPath, browserOrigin).toString()
      : linuxDoCallbackPath)
  const linuxDoReferenceItems = useMemo(
    () => [
      {
        label: ta("linuxDoAuthorizeUrlLabel"),
        value:
          settingsDraft.registrationSettings.linuxDo.authorizeUrl || LINUX_DO_DEFAULT_AUTHORIZE_URL,
      },
      {
        label: ta("linuxDoTokenUrlLabel"),
        value: settingsDraft.registrationSettings.linuxDo.tokenUrl || LINUX_DO_DEFAULT_TOKEN_URL,
      },
      {
        label: ta("linuxDoUserinfoUrlLabel"),
        value:
          settingsDraft.registrationSettings.linuxDo.userinfoUrl || LINUX_DO_DEFAULT_USERINFO_URL,
      },
      {
        label: ta("linuxDoCallbackUrlLabel"),
        value: linuxDoCallbackUrl,
      },
    ],
    [linuxDoCallbackUrl, settingsDraft.registrationSettings.linuxDo.authorizeUrl, settingsDraft.registrationSettings.linuxDo.tokenUrl, settingsDraft.registrationSettings.linuxDo.userinfoUrl, ta],
  )
  const batchDomainProgressPercent =
    batchDomainProgress && batchDomainProgress.total > 0
      ? Math.round((batchDomainProgress.completed / batchDomainProgress.total) * 100)
      : 0
  const batchDomainCurrentIndex = batchDomainProgress
    ? Math.min(
        batchDomainProgress.completed + (batchDomainProgress.currentDomain ? 1 : 0),
        batchDomainProgress.total,
      )
    : 0
  const hasUnsavedCoreSettings = useMemo(
    () => !areSettingsEqual(normalizedSettingsDraft, savedSettings),
    [normalizedSettingsDraft, savedSettings],
  )
  const hasUnsavedCloudflareChanges = useMemo(
    () =>
      normalizedCloudflareSettings.enabled !== savedCloudflareSettings.enabled ||
      normalizedCloudflareSettings.autoSyncEnabled !== savedCloudflareSettings.autoSyncEnabled ||
      cloudflareApiTokenInput.trim().length > 0,
    [cloudflareApiTokenInput, normalizedCloudflareSettings, savedCloudflareSettings],
  )
  const hasUnsavedChanges = hasUnsavedCoreSettings || hasUnsavedCloudflareChanges
  const discardUnsavedChanges = useCallback(() => {
    setSettingsDraft(savedSettings)
    setCloudflareSettings(savedCloudflareSettings)
    setCloudflareApiTokenInput("")
  }, [savedCloudflareSettings, savedSettings])

  const confirmDiscardUnsavedChanges = useCallback(async () => {
    if (!hasUnsavedChanges) {
      return true
    }

    const shouldDiscard = await requestConfirmation({
      title: ta("settingsPanelTitle"),
      description: ta("settingsUnsavedChangesConfirm"),
      confirmLabel: tc("discard"),
      tone: "danger",
    })
    if (shouldDiscard) {
      discardUnsavedChanges()
    }

    return shouldDiscard
  }, [discardUnsavedChanges, hasUnsavedChanges, requestConfirmation, ta, tc])

  const maybeDiscardUnsavedSettings = useCallback(async () => {
    if (view !== "settings") {
      return true
    }

    return await confirmDiscardUnsavedChanges()
  }, [confirmDiscardUnsavedChanges, view])

  const handleSelectView = useCallback(
    async (nextView: ConsoleView) => {
      if (nextView === view) {
        return true
      }

      if (view === "settings" && !(await confirmDiscardUnsavedChanges())) {
        return false
      }

      setView(nextView)
      return true
    },
    [confirmDiscardUnsavedChanges, view],
  )

  const handleSelectSettingsSection = useCallback(
    async (nextSection: SettingsSection) => {
      if (nextSection === settingsSection) {
        return
      }

      if (!(await confirmDiscardUnsavedChanges())) {
        return
      }

      setSettingsSection(nextSection)
    },
    [confirmDiscardUnsavedChanges, settingsSection],
  )

  useEffect(() => {
    if (!settingsSections.some((section) => section.id === settingsSection)) {
      setSettingsSection(settingsSections[0]?.id ?? "cloudflare")
    }
  }, [settingsSection, settingsSections])

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ta("settingsUnsavedChangesConfirm")
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [hasUnsavedChanges, ta])

  const handleClearAdminSession = useCallback(async () => {
    if (!(await maybeDiscardUnsavedSettings())) {
      return
    }

    void clearAdminSession()
  }, [clearAdminSession, maybeDiscardUnsavedSettings])

  const handleLocaleChange = useCallback(async () => {
    if (!(await maybeDiscardUnsavedSettings())) {
      return
    }

    const nextLocale = locale === "en" ? "zh" : "en"
    startLocaleTransition(() => {
      router.replace(pathname, { locale: nextLocale })
    })
    toast({
      title: nextLocale === "en" ? tm("switchedToEn") : tm("switchedToZh"),
      color: "primary",
      variant: "flat",
      icon: <Languages size={16} />,
    })
  }, [locale, maybeDiscardUnsavedSettings, pathname, router, startLocaleTransition, tm, toast])

  if (isBootstrapping) {
    return (
      <div className="relative flex min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef4ff_45%,#f6f8fb_100%)] dark:bg-[linear-gradient(180deg,#020617_0%,#0f172a_55%,#111827_100%)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.12),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.42),transparent_30%)]" />
        <div className="relative m-auto rounded-[2rem] border border-white/70 bg-white/80 px-8 py-7 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/75 dark:shadow-none">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
            <Sparkles size={13} />
            {brandName}
          </div>
          <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">{ta("loadingStatus")}</div>
        </div>
      </div>
    )
  }

  if (!hasAdminSession || !sessionInfo || !currentUser) {
    return null
  }

  return (
    <div className="tm-page-backdrop relative flex min-h-screen overflow-hidden text-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.12),transparent_24%),radial-gradient(circle_at_65%_78%,rgba(45,212,191,0.12),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.42),transparent_30%),radial-gradient(circle_at_65%_78%,rgba(20,184,166,0.1),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:42px_42px] opacity-[0.18] dark:bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)]" />

      <div className="relative hidden h-screen px-4 py-4 xl:block">
        <AdminConsoleSidebar
          menuItems={menuItems}
          activeView={view}
          onSelectView={handleSelectView}
          currentUser={currentUser}
          serviceStatus={serviceStatus}
          mailboxCount={activeMailboxAccountsCount}
          managedDomainsCount={isAdmin ? managedDomains.length : ownedManagedDomainsCount}
          managedDomainsLimit={!isAdmin ? currentUserManagedDomainLimit : undefined}
          activeDomainsCount={activeDomainsCount}
          pendingDomainsCount={pendingDomainsCount}
          statusLabels={{
            active: ts("domainStatusActive"),
            pending: ts("domainStatusPending"),
          }}
          canUseSensitiveAdminActions={canUseSensitiveAdminActions}
          ta={ta}
        />
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden xl:py-4 xl:pr-4">
        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden border border-white/65 bg-white/70 shadow-[0_30px_90px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/70 dark:shadow-none xl:rounded-[2rem]">
          <div className="border-b border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80 xl:hidden">
            <div className="flex items-center justify-between gap-2">
              <Button
                isIconOnly
                variant="light"
                size="sm"
                className="text-slate-600 dark:text-slate-300"
                onPress={() => setIsSidebarOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={20} />
              </Button>

              <div className="min-w-0 flex-1 text-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
                  <Sparkles size={12} />
                  {brandName}
                </div>
                <div className="mt-2 truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {currentMenuItem.label}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  isIconOnly
                  variant="light"
                  size="sm"
                  className="h-8 w-8 min-w-0 text-slate-600 dark:text-slate-300"
                  aria-label={locale === "en" ? th("switchToChinese") : th("switchToEnglish")}
                  title={locale === "en" ? th("switchToChinese") : th("switchToEnglish")}
                  onPress={() => void handleLocaleChange()}
                  isDisabled={isLocalePending}
                >
                  <Languages size={17} />
                </Button>
                <ThemeModeToggle
                  showLabel={false}
                  variant="light"
                  buttonClassName="h-8 w-8 min-w-0 text-slate-600 dark:text-slate-300"
                />
              </div>
            </div>
          </div>

          <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/78 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/72">
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <div className="min-w-0 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tm-chip-strong">
                    <Sparkles size={13} />
                    {brandName}
                  </span>
                  <span className="tm-chip">
                    <Activity size={13} />
                    {currentMenuItem.label}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {view === "settings" && !isCloudflareSection && (
                  <Button
                    size="sm"
                    startContent={<Check size={14} />}
                    className="rounded-full bg-sky-600 px-4 text-white hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500"
                    onPress={handleSaveSettings}
                    isLoading={settingsSaving}
                    isDisabled={!hasUnsavedChanges || settingsSaving}
                  >
                    {ta("settingsSaveAction")}
                  </Button>
                )}

                {!canUseSensitiveAdminActions && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                    <ShieldAlert size={13} />
                    {ta("insecureContextTitle")}
                  </div>
                )}

                <span className="hidden rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300 sm:inline-flex">
                  {currentUser.username}
                </span>
                <span className={`hidden rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm md:inline-flex ${currentUserRoleBadgeClassName}`}>
                  {currentUser.role === "admin" ? ta("roleAdmin") : ta("roleUser")}
                </span>

                <div className="hidden xl:block">
                  <ThemeModeToggle
                    showLabel={false}
                    variant="light"
                    buttonClassName="h-9 w-9 min-w-0 rounded-full text-slate-600 dark:text-slate-300"
                  />
                </div>

                <Button
                  isIconOnly
                  variant="light"
                  size="sm"
                  className="h-9 w-9 min-w-0 rounded-full border border-slate-200 bg-white/75 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200"
                  aria-label={locale === "en" ? th("switchToChinese") : th("switchToEnglish")}
                  title={locale === "en" ? th("switchToChinese") : th("switchToEnglish")}
                  onPress={() => void handleLocaleChange()}
                  isDisabled={isLocalePending}
                >
                  <Languages size={16} />
                </Button>

                <Button
                  isIconOnly
                  variant="light"
                  size="sm"
                  className="h-9 w-9 min-w-0 rounded-full border border-slate-200 bg-white/75 text-slate-700 shadow-sm hover:text-red-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:text-red-400"
                  aria-label={ta("logout")}
                  title={ta("logout")}
                  onPress={handleClearAdminSession}
                >
                  <LogOut size={15} />
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-6xl space-y-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={view}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="space-y-6"
                >

            {/* ====== MAILBOXES ====== */}
            {view === "mailboxes" && (
              <>
                <SectionHeader
                  title={ta("mailboxPanelTitle")}
                  action={
                    <IconActionButton
                      icon={<RefreshCw size={14} />}
                      label={ta("refreshMailboxes")}
                      onPress={() => void loadMailboxAccounts()}
                      isLoading={mailboxAccountsLoading}
                    />
                  }
                />

                <motion.div
                  className="grid gap-4 sm:grid-cols-3"
                  initial="hidden"
                  animate="visible"
                  variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
                >
                  <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                    <MetricCard
                      label={ta("runtimeMailboxLabel")}
                      value={String(mailboxAccounts.length)}
                      tone="neutral"
                    />
                  </motion.div>
                  <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                    <MetricCard
                      label={ta("overviewActiveMailboxes")}
                      value={String(activeMailboxAccountsCount)}
                      tone="success"
                    />
                  </motion.div>
                  <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                    <MetricCard
                      label={ta("mailboxCurrentLabel")}
                      value={currentAccount?.address || ta("mailboxCurrentEmpty")}
                      tone="neutral"
                    />
                  </motion.div>
                </motion.div>

                <Panel>
                  <PanelHeader
                    title={ta("mailboxCreateTitle")}
                    icon={<Mail size={16} />}
                  />
                  <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(14rem,0.95fr)_auto] lg:items-end">
                    <Input
                      label={ta("mailboxCreateLocalPartLabel")}
                      value={mailboxLocalPartInput}
                      onValueChange={setMailboxLocalPartInput}
                      placeholder={ta("mailboxCreateLocalPartPlaceholder")}
                      variant="bordered"
                      size="sm"
                      classNames={TM_INPUT_CLASSNAMES}
                    />
                    <Select
                      label={ta("mailboxCreateDomainLabel")}
                      placeholder={ta("mailboxCreateDomainPlaceholder")}
                      selectedKeys={mailboxDomainInput ? [mailboxDomainInput] : []}
                      onSelectionChange={(keys) => {
                        const value = Array.from(keys)[0] as string
                        if (value) {
                          setMailboxDomainInput(value)
                        }
                      }}
                      isDisabled={isCreatingMailbox || availableMailboxDomains.length === 0}
                      size="sm"
                    >
                      {availableMailboxDomains.map((domain) => (
                        <SelectItem key={domain.domain} textValue={domain.domain}>
                          <div className="flex items-center gap-2">
                            <span>{domain.domain}</span>
                            {domain.isShared ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                                {ts("domainSharedBadge")}
                              </span>
                            ) : null}
                          </div>
                        </SelectItem>
                      ))}
                    </Select>
                    <IconActionButton
                      icon={<Plus size={14} />}
                      label={ta("mailboxCreateSubmit")}
                      className="bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-600 dark:text-white dark:hover:bg-sky-500"
                      onPress={handleCreateMailbox}
                      isLoading={isCreatingMailbox}
                      disabled={availableMailboxDomains.length === 0}
                    />
                  </div>
                  <div className="px-5 pb-5">
                    <div className="tm-chip">
                      <Mail size={12} />
                      {mailboxPreviewAddress || ta("mailboxCreatePreviewPlaceholder")}
                    </div>
                    {availableMailboxDomains.length === 0 && (
                      <p className="mt-3 text-sm text-amber-600 dark:text-amber-300">
                        {ta("mailboxCreateNoDomainAvailable")}
                      </p>
                    )}
                  </div>
                </Panel>

                {mailboxAccounts.length === 0 ? (
                  <EmptyState title={ta("mailboxEmptyTitle")} />
                ) : (
                  <div className="grid gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
                    <Panel className="h-fit">
                      <PanelHeader
                        title={ta("mailboxListTitle")}
                        icon={<Inbox size={16} />}
                      />
                      <div className="divide-y divide-slate-100/80 dark:divide-slate-800/60">
                        {mailboxAccounts.map((account) => {
                          const isCurrentMailbox = currentAccount?.id === account.id

                          return (
                            <div key={account.id} className="px-5 py-4">
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  className={`flex min-w-0 flex-1 items-start justify-between gap-3 rounded-[1.2rem] border px-4 py-3 text-left transition-all duration-150 ${
                                    isCurrentMailbox
                                      ? "border-sky-200 bg-sky-50/80 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100"
                                      : "border-slate-200/80 bg-white/70 text-slate-900 hover:border-slate-300 hover:bg-white dark:border-slate-800/80 dark:bg-slate-950/45 dark:text-white dark:hover:border-slate-700 dark:hover:bg-slate-950/65"
                                  } ${account.isDeleted ? "cursor-not-allowed opacity-60" : ""}`}
                                  onClick={() => void activateMailbox(account)}
                                  disabled={account.isDeleted || activatingMailboxId === account.id}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium">{account.address}</div>
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                      {isCurrentMailbox && (
                                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/60 dark:text-sky-200">
                                          {ta("mailboxCurrentBadge")}
                                        </span>
                                      )}
                                      {account.isDisabled && (
                                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                          {ta("mailboxDisabledBadge")}
                                        </span>
                                      )}
                                      {account.isDeleted && (
                                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                                          {ta("mailboxDeletedBadge")}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-slate-500 dark:bg-slate-900/80 dark:text-slate-300">
                                    {activatingMailboxId === account.id ? (
                                      <RefreshCw size={15} className="animate-spin" />
                                    ) : (
                                      <Mail size={15} />
                                    )}
                                  </div>
                                </button>
                                <IconActionButton
                                  danger
                                  icon={<Trash2 size={13} />}
                                  label={tc("delete")}
                                  onPress={() => void handleDeleteMailbox(account)}
                                  isLoading={deletingMailboxId === account.id}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </Panel>

                    <Panel className="min-h-[38rem]">
                      <PanelHeader
                        title={currentAccount?.address || ta("mailboxViewerTitle")}
                        icon={<Mail size={16} />}
                      />
                      <div className="h-[38rem] overflow-hidden">
                        {currentAccount ? (
                          selectedMessage ? (
                            <MessageDetail
                              message={selectedMessage}
                              onBack={() => setSelectedMessage(null)}
                              onDelete={() => {
                                setSelectedMessage(null)
                                setMailboxRefreshKey((current) => current + 1)
                              }}
                            />
                          ) : (
                            <MessageList
                              onSelectMessage={setSelectedMessage}
                              refreshKey={mailboxRefreshKey}
                            />
                          )
                        ) : (
                          <div className="p-5">
                            <EmptyState title={ta("mailboxMessagesEmptyTitle")} />
                          </div>
                        )}
                      </div>
                    </Panel>
                  </div>
                )}
              </>
            )}

            {/* ====== OVERVIEW ====== */}
            {view === "overview" && (
              <>
                <SectionHeader
                  title={ta("systemPanelTitle")}
                  action={
                    isAdmin ? (
                      <IconActionButton
                        icon={<RefreshCw size={14} />}
                        label={ta("refreshOps")}
                        onPress={() => void loadOps()}
                        isLoading={logsLoading}
                      />
                    ) : undefined
                  }
                />

                <motion.div
                  className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-3"
                  initial="hidden"
                  animate="visible"
                  variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
                >
                  <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                    <MetricCard
                      label={ta("serviceStatus")}
                      value={serviceStatusLabel}
                      tone={serviceTone}
                    />
                  </motion.div>
                  {isAdmin ? (
                    <>
                      <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                        <MetricCard
                          label={ta("runtimeCpuLabel")}
                          value={formatPercent(adminMetrics?.runtime.cpuUsagePercent)}
                          detail={ta("overviewRealtimeSample")}
                          progressPercent={adminMetrics?.runtime.cpuUsagePercent}
                          tone={(adminMetrics?.runtime.cpuUsagePercent ?? 0) >= 85 ? "danger" : (adminMetrics?.runtime.cpuUsagePercent ?? 0) >= 60 ? "warning" : "success"}
                        />
                      </motion.div>
                      <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                        <MetricCard
                          label={ta("runtimeMemoryLabel")}
                          value={formatPercent(adminMetrics?.runtime.memoryUsagePercent)}
                          detail={`${formatBytes(adminMetrics?.runtime.memoryUsedBytes)} / ${formatBytes(adminMetrics?.runtime.memoryTotalBytes)}`}
                          progressPercent={adminMetrics?.runtime.memoryUsagePercent}
                          tone={(adminMetrics?.runtime.memoryUsagePercent ?? 0) >= 90 ? "danger" : (adminMetrics?.runtime.memoryUsagePercent ?? 0) >= 70 ? "warning" : "success"}
                        />
                      </motion.div>
                      <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                        <MetricCard
                          label={ta("managedDomainCount")}
                          value={String(totalDomainsMetric)}
                          detail={`${ta("overviewActiveDomains")} ${activeDomainsMetric} · ${ta("overviewPendingDomains")} ${pendingDomainsMetric}`}
                          progressPercent={formatRatioPercent(activeDomainsMetric, totalDomainsMetric)}
                          tone="neutral"
                        />
                      </motion.div>
                      <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                        <MetricCard
                          label={ta("runtimeMailboxLabel")}
                          value={String(totalAccountsMetric)}
                          detail={`${ta("overviewActiveMailboxes")} ${activeAccountsMetric}`}
                          progressPercent={formatRatioPercent(activeAccountsMetric, totalAccountsMetric)}
                          tone="neutral"
                        />
                      </motion.div>
                      <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                        <MetricCard
                          label={ta("runtimeMessageLabel")}
                          value={String(totalMessagesMetric)}
                          detail={`${ta("overviewActiveMessages")} ${activeMessagesMetric} · ${ta("overviewDeletedMessages")} ${deletedMessagesMetric}`}
                          progressPercent={formatRatioPercent(activeMessagesMetric, totalMessagesMetric)}
                          tone="neutral"
                        />
                      </motion.div>
                      {overviewDetailCards.map((card) => (
                        <motion.div
                          key={card.label}
                          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
                        >
                          <MetricCard
                            label={card.label}
                            value={card.value}
                            detail={card.detail}
                            tone={card.tone}
                          />
                        </motion.div>
                      ))}
                    </>
                  ) : (
                    <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                      <MetricCard
                        label={ta("managedDomainCount")}
                        value={String(managedDomains.length)}
                        detail={managedDomainUsageSummary}
                        tone="neutral"
                      />
                    </motion.div>
                  )}
                </motion.div>
              </>
            )}

            {/* ====== SETTINGS ====== */}
            {view === "settings" && (
              <>
                <SectionHeader
                  title={ta("settingsPanelTitle")}
                />

                <Panel className="p-1">
                  <div className="flex flex-wrap gap-2">
                    {settingsSections.map((section) => {
                      const active = settingsSection === section.id
                      return (
                        <Button
                          key={section.id}
                          size="sm"
                          variant={active ? "flat" : "light"}
                          className={`rounded-2xl px-4 ${active ? "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100" : "text-slate-600 dark:text-slate-300"}`}
                          onPress={() => void handleSelectSettingsSection(section.id)}
                        >
                          {section.label}
                        </Button>
                      )
                    })}
                  </div>
                </Panel>

                {settingsSection === "cloudflare" && (
                  <div className="max-w-3xl">
                    <Panel>
                      <PanelHeader title={ta("cloudflareTitle")} icon={<Cloud size={16} />} />
                      <div className="space-y-4 p-5">
                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {cloudflareSettings.enabled
                              ? ta("cloudflareEnabledOn")
                              : ta("cloudflareEnabledOff")}
                          </div>
                          <label className="inline-flex cursor-pointer items-center">
                            <input
                              type="checkbox"
                              checked={cloudflareSettings.enabled}
                              onChange={(event) =>
                                setCloudflareSettings((current) => ({
                                  ...current,
                                  enabled: event.target.checked,
                                }))
                              }
                              className="peer sr-only"
                            />
                            <span className="relative h-7 w-12 rounded-full bg-slate-300 transition-colors duration-200 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:bg-sky-600 peer-checked:after:translate-x-5 dark:bg-slate-700 dark:peer-checked:bg-sky-500" />
                          </label>
                        </div>

                        <div className="space-y-1.5">
                          <Input
                            label={ta("cloudflareTokenLabel")}
                            type="password"
                            placeholder={
                              cloudflareSettings.apiTokenConfigured
                                ? ta("cloudflareTokenPlaceholderConfigured")
                                : ta("cloudflareTokenPlaceholder")
                            }
                            value={cloudflareApiTokenInput}
                            onValueChange={setCloudflareApiTokenInput}
                            variant="bordered"
                            size="sm"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                        </div>

                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {cloudflareSettings.autoSyncEnabled
                              ? ta("cloudflareAutoSyncOn")
                              : ta("cloudflareAutoSyncOff")}
                          </div>
                          <label className="inline-flex cursor-pointer items-center">
                            <input
                              type="checkbox"
                              checked={cloudflareSettings.autoSyncEnabled}
                              onChange={(event) =>
                                setCloudflareSettings((current) => ({
                                  ...current,
                                  autoSyncEnabled: event.target.checked,
                                }))
                              }
                              className="peer sr-only"
                            />
                            <span className="relative h-7 w-12 rounded-full bg-slate-300 transition-colors duration-200 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:bg-sky-600 peer-checked:after:translate-x-5 dark:bg-slate-700 dark:peer-checked:bg-sky-500" />
                          </label>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="flat"
                            startContent={<RefreshCw size={14} />}
                            className="h-10 rounded-2xl bg-slate-100/80 px-4 text-slate-700 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-700/70"
                            onPress={() => void handleTestCloudflareToken()}
                            isLoading={cloudflareTesting}
                          >
                            {ta("cloudflareTestAction")}
                          </Button>
                          <Button
                            size="sm"
                            startContent={<Check size={14} />}
                            className="h-10 rounded-2xl bg-sky-600 px-4 text-white hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500"
                            onPress={() => void handleSaveCloudflareSettings()}
                            isLoading={cloudflareSaving}
                          >
                            {tc("save")}
                          </Button>
                        </div>
                      </div>
                    </Panel>
                  </div>
                )}

                {settingsSection === "core" && (
                  <div className="space-y-6">
                    <Panel>
                      <PanelHeader title={ta("systemEnabledLabel")} />
                      <div className="p-5">
                        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                              {settingsDraft.systemEnabled ? ta("systemEnabledOn") : ta("systemEnabledOff")}
                            </div>
                          </div>

                          <label className={`inline-flex items-center ${isUpdatingSystemEnabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                            <input
                              type="checkbox"
                              checked={settingsDraft.systemEnabled}
                              disabled={isUpdatingSystemEnabled}
                              onChange={(event) => void handleToggleSystemEnabled(event.target.checked)}
                              className="peer sr-only"
                            />
                            <span className="relative h-7 w-12 rounded-full bg-slate-300 transition-colors duration-200 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:bg-sky-600 peer-checked:after:translate-x-5 dark:bg-slate-700 dark:peer-checked:bg-sky-500" />
                          </label>
                        </div>
                      </div>
                    </Panel>

                    <Panel>
                    <PanelHeader title={ta("brandingSettingsTitle")} />
                    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="space-y-4">
                        <Input
                          label={ta("brandingNameLabel")}
                          placeholder="TmpMail"
                          value={settingsDraft.branding.name || ""}
                          onValueChange={(value) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              branding: {
                                ...current.branding,
                                name: value || undefined,
                              },
                            }))
                          }
                          variant="bordered"
                          size="sm"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Input
                          label={ta("brandingLogoUrlLabel")}
                          placeholder="/brand-mark.svg"
                          value={settingsDraft.branding.logoUrl || ""}
                          onValueChange={(value) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              branding: {
                                ...current.branding,
                                logoUrl: value || undefined,
                              },
                            }))
                          }
                          variant="bordered"
                          size="sm"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                      </div>

                      <div className="rounded-[1.6rem] border border-slate-200/80 bg-slate-50/85 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
                        <div className="tm-section-label">{ta("brandingPreviewLabel")}</div>
                        <div className="mt-4 flex items-center gap-3">
                          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-900">
                            <BrandMark
                              srcOverride={draftBranding.brandLogoUrl}
                              alt={`${draftBranding.brandName} logo`}
                              className="h-10 w-10"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-slate-950 dark:text-white">
                              {draftBranding.brandName}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Panel>

                  <Panel>
                    <PanelHeader title={ta("overviewSettingsTitle")} />
                    <div className="grid gap-4 p-5 md:grid-cols-3">
                        <Input
                          label={ta("mailExchangeHostLabel")}
                          placeholder="mail.example.com"
                          value={settingsDraft.mailExchangeHost || ""}
                          onValueChange={(value) =>
                            setSettingsDraft((current) => ({ ...current, mailExchangeHost: value || undefined }))
                          }
                          variant="bordered"
                          size="sm"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Input
                          label={ta("mailRouteTargetLabel")}
                          placeholder="23.165.200.136"
                          value={settingsDraft.mailRouteTarget || ""}
                          onValueChange={(value) =>
                            setSettingsDraft((current) => ({ ...current, mailRouteTarget: value || undefined }))
                          }
                          variant="bordered"
                          size="sm"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Input
                          label={ta("domainTxtPrefixLabel")}
                          placeholder="@"
                          value={settingsDraft.domainTxtPrefix || ""}
                          onValueChange={(value) =>
                            setSettingsDraft((current) => ({ ...current, domainTxtPrefix: value || undefined }))
                          }
                          variant="bordered"
                          size="sm"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                      </div>
                    </Panel>
                  </div>
                )}

                {settingsSection === "registration" && (
                  <div className="space-y-6">
                    <div className="grid gap-6 xl:grid-cols-2">
                      <Panel>
                        <PanelHeader title={ta("registrationSettingsTitle")} />
                        <div className="space-y-4 p-5">
                          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                                {settingsDraft.registrationSettings.openRegistrationEnabled ? ta("openRegistrationOn") : ta("openRegistrationOff")}
                              </div>
                            </div>

                            <label className="inline-flex cursor-pointer items-center">
                              <input
                                type="checkbox"
                                checked={settingsDraft.registrationSettings.openRegistrationEnabled}
                                onChange={(event) =>
                                  setSettingsDraft((current) => ({
                                    ...current,
                                    registrationSettings: {
                                      ...current.registrationSettings,
                                      openRegistrationEnabled: event.target.checked,
                                    },
                                  }))
                                }
                                className="peer sr-only"
                              />
                              <span className="relative h-7 w-12 rounded-full bg-slate-300 transition-colors duration-200 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:bg-sky-600 peer-checked:after:translate-x-5 dark:bg-slate-700 dark:peer-checked:bg-sky-500" />
                            </label>
                          </div>

                          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                                {settingsDraft.registrationSettings.consoleInviteCodeRequired
                                  ? ta("inviteCodeRequiredOn")
                                  : ta("inviteCodeRequiredOff")}
                              </div>
                            </div>

                            <label className="inline-flex cursor-pointer items-center">
                              <input
                                type="checkbox"
                                checked={settingsDraft.registrationSettings.consoleInviteCodeRequired}
                                onChange={(event) =>
                                  setSettingsDraft((current) => ({
                                    ...current,
                                    registrationSettings: {
                                      ...current.registrationSettings,
                                      consoleInviteCodeRequired: event.target.checked,
                                    },
                                  }))
                                }
                                className="peer sr-only"
                              />
                              <span className="relative h-7 w-12 rounded-full bg-slate-300 transition-colors duration-200 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:bg-sky-600 peer-checked:after:translate-x-5 dark:bg-slate-700 dark:peer-checked:bg-sky-500" />
                            </label>
                          </div>

                          <div className="space-y-4 rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                                  {ta("inviteCodePanelTitle")}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="flat"
                                startContent={inviteCodesLoading ? <Spinner size="sm" /> : <RefreshCw size={14} />}
                                className="h-10 rounded-2xl bg-slate-100/90 px-4 text-slate-700 hover:bg-slate-200/90 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-700/80"
                                onPress={() => void loadInviteCodes()}
                                isDisabled={inviteCodesLoading}
                              >
                                {ta("refreshInviteCodes")}
                              </Button>
                            </div>

                            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_11rem_auto]">
                              <Input
                                label={ta("inviteCodeNameLabel")}
                                placeholder={ta("inviteCodeNamePlaceholder")}
                                value={newInviteCodeName}
                                onValueChange={setNewInviteCodeName}
                                variant="bordered"
                                size="sm"
                                classNames={TM_INPUT_CLASSNAMES}
                              />
                              <Input
                                label={ta("inviteCodeMaxUsesLabel")}
                                placeholder={ta("inviteCodeMaxUsesPlaceholder")}
                                value={newInviteCodeMaxUses}
                                onValueChange={setNewInviteCodeMaxUses}
                                variant="bordered"
                                size="sm"
                                classNames={TM_INPUT_CLASSNAMES}
                              />
                              <div className="flex items-end">
                                <Button
                                  size="sm"
                                  className="h-10 rounded-2xl bg-sky-600 px-4 text-white hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500"
                                  onPress={() => void handleCreateInviteCode()}
                                  isLoading={isCreatingInviteCode}
                                  isDisabled={inviteCodesLoading}
                                >
                                  {ta("inviteCodeGenerate")}
                                </Button>
                              </div>
                            </div>

                            {pendingInviteCode && (
                              <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/90 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/25">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                                      {ta("inviteCodeLatestTitle", { name: pendingInviteCode.code.name })}
                                    </div>
                                    <div className="mt-3 break-all rounded-2xl bg-white/80 px-3 py-2 font-mono text-sm text-emerald-900 shadow-sm dark:bg-slate-950/60 dark:text-emerald-100">
                                      {pendingInviteCode.inviteCode}
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="flat"
                                    startContent={<Copy size={13} />}
                                    className="h-10 rounded-2xl bg-white/80 px-4 text-emerald-800 hover:bg-white dark:bg-slate-950/60 dark:text-emerald-100 dark:hover:bg-slate-950/80"
                                    onPress={() => void handleCopyInviteCode({ id: pendingInviteCode.code.id, inviteCode: pendingInviteCode.inviteCode })}
                                  >
                                    {copiedInviteCodeId === pendingInviteCode.code.id
                                      ? tc("copied")
                                      : ta("inviteCodeCopy")}
                                  </Button>
                                </div>
                              </div>
                            )}

                            {adminInviteCodes.length === 0 ? (
                              <EmptyState compact title={ta("inviteCodeEmptyTitle")} />
                            ) : (
                              <div className="space-y-3">
                                {adminInviteCodes.map((code) => (
                                  <div
                                    key={code.id}
                                    className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/75 p-4 dark:border-slate-800/70 dark:bg-slate-950/50 sm:flex-row sm:items-center sm:justify-between"
                                  >
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                                          {code.name}
                                        </span>
                                        {code.isDisabled ? (
                                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                                            {ta("inviteCodeStatusDisabled")}
                                          </span>
                                        ) : (
                                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                                            {ta("inviteCodeStatusActive")}
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">
                                        {code.maskedCode}
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-400">
                                        {code.maxUses !== undefined
                                          ? ta("inviteCodeUsageSummaryLimited", {
                                              used: code.usesCount,
                                              max: code.maxUses,
                                              remaining: code.remainingUses ?? 0,
                                            })
                                          : ta("inviteCodeUsageSummaryUnlimited", {
                                              used: code.usesCount,
                                            })}
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-400">
                                        {ta("keyCreatedAt", {
                                          date: new Date(code.createdAt).toLocaleString(),
                                        })}
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <IconActionButton
                                        icon={<ShieldAlert size={13} />}
                                        label={code.isDisabled ? ta("inviteCodeEnable") : ta("inviteCodeDisable")}
                                        onPress={() => void handleToggleInviteCodeDisabled(code)}
                                        isLoading={updatingInviteCodeId === code.id}
                                      />
                                      <IconActionButton
                                        danger
                                        icon={<Trash2 size={13} />}
                                        label={ta("inviteCodeDelete")}
                                        onPress={() => void handleDeleteInviteCode(code)}
                                        isLoading={deletingInviteCodeId === code.id}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <Input
                            label={ta("allowedEmailSuffixesLabel")}
                            placeholder={ta("allowedEmailSuffixesPlaceholder")}
                            value={settingsDraft.registrationSettings.allowedEmailSuffixes.join(", ")}
                            onValueChange={(value) =>
                              updateAllowedEmailSuffixesDraft(parseSuffixList(value))
                            }
                            variant="bordered"
                            size="sm"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                        </div>
                      </Panel>

                      <Panel>
                        <PanelHeader title={ta("emailOtpTitle")} />
                        <div className="space-y-4 p-5">
                          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                                {settingsDraft.registrationSettings.emailOtp.enabled ? ta("emailOtpEnabledOn") : ta("emailOtpEnabledOff")}
                              </div>
                            </div>

                            <label className="inline-flex cursor-pointer items-center">
                              <input
                                type="checkbox"
                                checked={settingsDraft.registrationSettings.emailOtp.enabled}
                                onChange={(event) =>
                                  setSettingsDraft((current) => ({
                                    ...current,
                                    registrationSettings: {
                                      ...current.registrationSettings,
                                      emailOtp: {
                                        ...current.registrationSettings.emailOtp,
                                        enabled: event.target.checked,
                                        subject:
                                          event.target.checked &&
                                          !(current.registrationSettings.emailOtp.subject || "").trim()
                                            ? emailOtpDefaultSubject
                                            : current.registrationSettings.emailOtp.subject,
                                        body:
                                          event.target.checked &&
                                          !(current.registrationSettings.emailOtp.body || "").trim()
                                            ? emailOtpDefaultBody
                                            : current.registrationSettings.emailOtp.body,
                                      },
                                    },
                                  }))
                                }
                                className="peer sr-only"
                              />
                              <span className="relative h-7 w-12 rounded-full bg-slate-300 transition-colors duration-200 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:bg-sky-600 peer-checked:after:translate-x-5 dark:bg-slate-700 dark:peer-checked:bg-sky-500" />
                            </label>
                          </div>

                          {settingsDraft.registrationSettings.emailOtp.enabled && (
                            <>
                              <div className="grid gap-4 md:grid-cols-2">
                                <Input
                                  label={ta("emailOtpTtlLabel")}
                                  type="number"
                                  value={String(settingsDraft.registrationSettings.emailOtp.ttlSeconds)}
                                  onValueChange={(value) =>
                                    setSettingsDraft((current) => ({
                                      ...current,
                                      registrationSettings: {
                                        ...current.registrationSettings,
                                        emailOtp: {
                                          ...current.registrationSettings.emailOtp,
                                          ttlSeconds: parseIntegerInput(
                                            value,
                                            current.registrationSettings.emailOtp.ttlSeconds,
                                            60,
                                            3600,
                                          ),
                                        },
                                      },
                                    }))
                                  }
                                  variant="bordered"
                                  size="sm"
                                  classNames={TM_INPUT_CLASSNAMES}
                                />
                                <Input
                                  label={ta("emailOtpCooldownLabel")}
                                  type="number"
                                  value={String(settingsDraft.registrationSettings.emailOtp.cooldownSeconds)}
                                  onValueChange={(value) =>
                                    setSettingsDraft((current) => ({
                                      ...current,
                                      registrationSettings: {
                                        ...current.registrationSettings,
                                        emailOtp: {
                                          ...current.registrationSettings.emailOtp,
                                          cooldownSeconds: parseIntegerInput(
                                            value,
                                            current.registrationSettings.emailOtp.cooldownSeconds,
                                            0,
                                            3600,
                                          ),
                                        },
                                      },
                                    }))
                                  }
                                  variant="bordered"
                                  size="sm"
                                  classNames={TM_INPUT_CLASSNAMES}
                                />
                              </div>

                              <Input
                                label={ta("emailOtpSubjectLabel")}
                                value={settingsDraft.registrationSettings.emailOtp.subject || ""}
                                onValueChange={(value) =>
                                  setSettingsDraft((current) => ({
                                    ...current,
                                    registrationSettings: {
                                      ...current.registrationSettings,
                                      emailOtp: {
                                        ...current.registrationSettings.emailOtp,
                                        subject: value || undefined,
                                      },
                                    },
                                  }))
                                }
                                variant="bordered"
                                size="sm"
                                classNames={TM_INPUT_CLASSNAMES}
                              />
                              <Textarea
                                label={ta("emailOtpBodyLabel")}
                                minRows={4}
                                value={settingsDraft.registrationSettings.emailOtp.body || ""}
                                onValueChange={(value) =>
                                  setSettingsDraft((current) => ({
                                    ...current,
                                    registrationSettings: {
                                      ...current.registrationSettings,
                                      emailOtp: {
                                        ...current.registrationSettings.emailOtp,
                                        body: value || undefined,
                                      },
                                    },
                                  }))
                                }
                                variant="bordered"
                                size="sm"
                                classNames={TM_INPUT_CLASSNAMES}
                              />
                            </>
                          )}
                        </div>
                      </Panel>
                    </div>

                    <Panel>
                      <PanelHeader title={ta("smtpSettingsTitle")} />
                      <div className="space-y-4 p-5">
                        <div className="rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                              {settingsDraft.smtp.host && settingsDraft.smtp.fromAddress
                                ? ta("smtpConfiguredOn")
                                : ta("smtpConfiguredOff")}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <Input
                            label={ta("smtpHostLabel")}
                            placeholder="smtp.example.com"
                            value={settingsDraft.smtp.host || ""}
                            onValueChange={(value) =>
                              setSettingsDraft((current) => ({
                                ...current,
                                smtp: {
                                  ...current.smtp,
                                  host: value || undefined,
                                },
                              }))
                            }
                            variant="bordered"
                            size="sm"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                          <Input
                            label={ta("smtpPortLabel")}
                            type="number"
                            value={String(settingsDraft.smtp.port)}
                            onValueChange={(value) =>
                              setSettingsDraft((current) => ({
                                ...current,
                                smtp: {
                                  ...current.smtp,
                                  port: parseIntegerInput(value, current.smtp.port, 1, 65535),
                                },
                              }))
                            }
                            variant="bordered"
                            size="sm"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                          <Select
                            label={ta("smtpSecurityLabel")}
                            selectedKeys={[settingsDraft.smtp.security]}
                            disallowEmptySelection
                            onSelectionChange={(keys) => {
                              const nextSecurity = Array.from(keys)[0]
                              if (typeof nextSecurity !== "string") {
                                return
                              }

                              setSettingsDraft((current) => {
                                const currentDefaultPort = defaultSmtpPortForSecurity(current.smtp.security)
                                const nextDefaultPort = defaultSmtpPortForSecurity(
                                  nextSecurity as AdminSystemSettings["smtp"]["security"],
                                )

                                return {
                                  ...current,
                                  smtp: {
                                    ...current.smtp,
                                    security: nextSecurity as AdminSystemSettings["smtp"]["security"],
                                    port: current.smtp.port === currentDefaultPort
                                      ? nextDefaultPort
                                      : current.smtp.port,
                                  },
                                }
                              })
                            }}
                            variant="bordered"
                            size="sm"
                          >
                            <SelectItem key="starttls" textValue={ta("smtpSecurityStarttlsLabel")}>
                              {ta("smtpSecurityStarttlsLabel")}
                            </SelectItem>
                            <SelectItem key="tls" textValue={ta("smtpSecurityTlsLabel")}>
                              {ta("smtpSecurityTlsLabel")}
                            </SelectItem>
                            <SelectItem key="plain" textValue={ta("smtpSecurityPlainLabel")}>
                              {ta("smtpSecurityPlainLabel")}
                            </SelectItem>
                          </Select>
                          <Input
                            label={ta("smtpUsernameLabel")}
                            value={settingsDraft.smtp.username || ""}
                            onValueChange={(value) =>
                              setSettingsDraft((current) => ({
                                ...current,
                                smtp: {
                                  ...current.smtp,
                                  username: value || undefined,
                                },
                              }))
                            }
                            variant="bordered"
                            size="sm"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                          <Input
                            label={ta("smtpPasswordLabel")}
                            type="password"
                            placeholder={
                              settingsDraft.smtp.passwordConfigured
                                ? ta("smtpPasswordPlaceholderConfigured")
                                : ta("smtpPasswordPlaceholder")
                            }
                            value={settingsDraft.smtp.password || ""}
                            onValueChange={(value) =>
                              setSettingsDraft((current) => ({
                                ...current,
                                smtp: {
                                  ...current.smtp,
                                  password: value || undefined,
                                },
                              }))
                            }
                            variant="bordered"
                            size="sm"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                          <Input
                            label={ta("smtpFromAddressLabel")}
                            placeholder="no-reply@example.com"
                            value={settingsDraft.smtp.fromAddress || ""}
                            onValueChange={(value) =>
                              setSettingsDraft((current) => ({
                                ...current,
                                smtp: {
                                  ...current.smtp,
                                  fromAddress: value || undefined,
                                },
                              }))
                            }
                            variant="bordered"
                            size="sm"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                          <Input
                            label={ta("smtpFromNameLabel")}
                            placeholder={draftBranding.brandName}
                            value={settingsDraft.smtp.fromName || ""}
                            onValueChange={(value) =>
                              setSettingsDraft((current) => ({
                                ...current,
                                smtp: {
                                  ...current.smtp,
                                  fromName: value || undefined,
                                },
                              }))
                            }
                            variant="bordered"
                            size="sm"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                        </div>
                      </div>
                    </Panel>
                  </div>
                )}

                {settingsSection === "limits" && (
                  <Panel>
                    <PanelHeader title={ta("userLimitsTitle")} />
                    <div className="grid gap-4 p-5 md:grid-cols-3">
                      <Input
                        label={ta("defaultDomainLimitLabel")}
                        type="number"
                        value={String(settingsDraft.userLimits.defaultDomainLimit)}
                        onValueChange={(value) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            userLimits: {
                              ...current.userLimits,
                              defaultDomainLimit: parseIntegerInput(value, current.userLimits.defaultDomainLimit, 0, 500),
                            },
                          }))
                        }
                        variant="bordered"
                        size="sm"
                        classNames={TM_INPUT_CLASSNAMES}
                      />
                      <Input
                        label={ta("mailboxLimitLabel")}
                        type="number"
                        value={String(settingsDraft.userLimits.mailboxLimit)}
                        onValueChange={(value) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            userLimits: {
                              ...current.userLimits,
                              mailboxLimit: parseIntegerInput(value, current.userLimits.mailboxLimit, 0, 200),
                            },
                          }))
                        }
                        variant="bordered"
                        size="sm"
                        classNames={TM_INPUT_CLASSNAMES}
                      />
                      <Input
                        label={ta("apiKeyLimitLabel")}
                        type="number"
                        value={String(settingsDraft.userLimits.apiKeyLimit)}
                        onValueChange={(value) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            userLimits: {
                              ...current.userLimits,
                              apiKeyLimit: parseIntegerInput(value, current.userLimits.apiKeyLimit, 0, 50),
                            },
                          }))
                        }
                        variant="bordered"
                        size="sm"
                        classNames={TM_INPUT_CLASSNAMES}
                      />
                    </div>
                  </Panel>
                )}

                {settingsSection === "integrations" && (
                  <Panel>
                    <PanelHeader title={ta("linuxDoTitle")} />
                    <div className="space-y-4 p-5">
                      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {settingsDraft.registrationSettings.linuxDo.enabled ? ta("linuxDoEnabledOn") : ta("linuxDoEnabledOff")}
                          </div>
                        </div>

                        <label className="inline-flex cursor-pointer items-center">
                          <input
                            type="checkbox"
                            checked={settingsDraft.registrationSettings.linuxDo.enabled}
                            onChange={(event) =>
                              setSettingsDraft((current) => ({
                                ...current,
                                registrationSettings: {
                                  ...current.registrationSettings,
                                  linuxDo: {
                                    ...current.registrationSettings.linuxDo,
                                    enabled: event.target.checked,
                                  },
                                },
                              }))
                            }
                            className="peer sr-only"
                          />
                          <span className="relative h-7 w-12 rounded-full bg-slate-300 transition-colors duration-200 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:bg-sky-600 peer-checked:after:translate-x-5 dark:bg-slate-700 dark:peer-checked:bg-sky-500" />
                        </label>
                      </div>

                      <div className="rounded-2xl border border-sky-200/70 bg-sky-50/75 p-4 backdrop-blur-sm dark:border-sky-900/50 dark:bg-sky-950/25">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-white">
                              {ta("linuxDoQuickstartTitle")}
                            </div>
                          </div>
                          <a
                            href={LINUX_DO_CONNECT_PORTAL_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-sm font-medium text-sky-600 underline-offset-4 hover:text-sky-700 hover:underline dark:text-sky-300 dark:hover:text-sky-200"
                          >
                            {ta("linuxDoQuickstartLink")}
                          </a>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35">
                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                          {ta("linuxDoReferenceTitle")}
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {linuxDoReferenceItems.map((item) => (
                            <div
                              key={item.label}
                              className="rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-800/70 dark:bg-slate-950/35"
                            >
                              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                                {item.label}
                              </div>
                              <div className="mt-1 break-all font-mono text-xs leading-6 text-slate-700 dark:text-slate-200">
                                {item.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <Input
                          label={ta("linuxDoClientIdLabel")}
                          value={settingsDraft.registrationSettings.linuxDo.clientId || ""}
                          onValueChange={(value) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              registrationSettings: {
                                ...current.registrationSettings,
                                linuxDo: {
                                  ...current.registrationSettings.linuxDo,
                                  clientId: value || undefined,
                                },
                              },
                            }))
                          }
                          variant="bordered"
                          size="sm"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Input
                          label={ta("linuxDoClientSecretLabel")}
                          type="password"
                          placeholder={
                            settingsDraft.registrationSettings.linuxDo.clientSecretConfigured
                              ? ta("linuxDoClientSecretPlaceholderConfigured")
                              : ta("linuxDoClientSecretPlaceholder")
                          }
                          value={settingsDraft.registrationSettings.linuxDo.clientSecret || ""}
                          onValueChange={(value) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              registrationSettings: {
                                ...current.registrationSettings,
                                linuxDo: {
                                  ...current.registrationSettings.linuxDo,
                                  clientSecret: value || undefined,
                                },
                              },
                            }))
                          }
                          variant="bordered"
                          size="sm"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                      </div>
                    </div>
                  </Panel>
                )}
              </>
            )}

            {/* ====== DOMAINS ====== */}
            {view === "domains" && (
              <>
                <SectionHeader
                  title={ta("domainPanelTitle")}
                  action={
                    <IconActionButton
                      icon={<RefreshCw size={14} />}
                      label={ts("refreshDomains")}
                      onPress={() => void loadManagedDomains()}
                      isLoading={managedDomainsLoading}
                    />
                  }
                />

                <motion.div
                  className="grid gap-4 sm:grid-cols-3"
                  initial="hidden"
                  animate="visible"
                  variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
                >
                  <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                    <MetricCard
                      label={ta("managedDomainCount")}
                      value={String(managedDomains.length)}
                      detail={managedDomainUsageSummary}
                      tone="neutral"
                    />
                  </motion.div>
                  <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                    <MetricCard label={ts("domainStatusActive")} value={String(activeDomainsCount)} tone="success" />
                  </motion.div>
                  <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}>
                    <MetricCard label={ts("domainStatusPending")} value={String(pendingDomainsCount)} tone="warning" />
                  </motion.div>
                </motion.div>

                {/* Add domain */}
                <Panel>
                  <div className="space-y-3 p-5">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <Input
                        label={ts("domainInputLabel")}
                        placeholder={ts("domainInputPlaceholder")}
                        value={managedDomainInput}
                        onValueChange={setManagedDomainInput}
                        variant="bordered"
                        size="sm"
                        classNames={TM_INPUT_CLASSNAMES}
                      />
                      <div className="flex shrink-0 items-center gap-2 sm:pb-0.5">
                        <Button
                          size="sm"
                          className="h-10 rounded-full bg-white px-4 text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800"
                          onPress={handleOpenBatchDomainModal}
                          startContent={<Sparkles size={14} />}
                        >
                          {ts("domainBatchOpenAction")}
                        </Button>
                        <Button
                          size="sm"
                          className="h-10 rounded-full bg-sky-600 px-4 text-white hover:bg-sky-700 dark:bg-sky-600 dark:text-white dark:hover:bg-sky-500"
                          onPress={handleCreateDomain}
                          isLoading={isCreatingDomain}
                          startContent={<Plus size={14} />}
                        >
                          {ts("addDomain")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Panel>

                {/* Domain list */}
                {managedDomains.length === 0 ? (
                  <EmptyState title={ts("noManagedDomains")} />
                ) : (
                  <div className="space-y-3">
                    {managedDomains.map((domain) => {
                      const canManageDomain = Boolean(isAdmin || domain.ownerUserId === currentUser?.id)
                      const isSharedReadonlyDomain = Boolean(domain.isShared && !canManageDomain)

                      return (
                        <Panel key={domain.id}>
                          <div className="p-5">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-sm font-medium text-slate-900 dark:text-white">
                                    {domain.domain}
                                  </span>
                                  <StatusBadge
                                    active={domain.isVerified || domain.status === "active"}
                                    activeLabel={ts("domainStatusActive")}
                                    pendingLabel={ts("domainStatusPending")}
                                  />
                                  {domain.isShared && (
                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                                      {ts("domainSharedBadge")}
                                    </span>
                                  )}
                                  {isSharedReadonlyDomain && (
                                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
                                      {ts("domainSharedReadonlyBadge")}
                                    </span>
                                  )}
                                  {isAdmin && domain.ownerUserId && usersById[domain.ownerUserId] && (
                                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                      {usersById[domain.ownerUserId].username}
                                    </span>
                                  )}
                                </div>

                              </div>

                              {canManageDomain && (
                                <div className="flex flex-wrap gap-1.5">
                                  <IconActionButton
                                    icon={<Users2 size={13} />}
                                    label={domain.isShared ? ts("domainShareDisable") : ts("domainShareEnable")}
                                    onPress={() => void handleToggleDomainSharing(domain)}
                                    isLoading={sharingDomainId === domain.id}
                                  />
                                  <IconActionButton
                                    icon={<Globe2 size={13} />}
                                    label={expandedDomainIds[domain.id] ? ts("hideDnsRecords") : ts("showDnsRecords")}
                                    onPress={() => void handleToggleDomainRecords(domain.id)}
                                    isLoading={!!recordsLoadingById[domain.id]}
                                  />
                                  <IconActionButton
                                    icon={<Check size={13} />}
                                    label={domain.isVerified ? ts("recheckDomain") : ts("verifyDomain")}
                                    onPress={() => void handleVerifyDomain(domain.id)}
                                    isLoading={verifyingDomainId === domain.id}
                                  />
                                  {canRunCloudflareSync && (
                                    <IconActionButton
                                      icon={<Cloud size={13} />}
                                      label={ta("cloudflareSyncAction")}
                                      onPress={() => void runCloudflareDomainSync(domain)}
                                      isLoading={cloudflareSyncingDomainId === domain.id}
                                    />
                                  )}
                                  {domain.verificationToken && (
                                    <IconActionButton
                                      danger
                                      icon={<Trash2 size={13} />}
                                      label={ts("deleteDomain")}
                                      onPress={() => void handleDeleteDomain(domain)}
                                      isLoading={deletingDomainId === domain.id}
                                    />
                                  )}
                                </div>
                              )}
                            </div>

                            {!domain.isVerified && domain.verificationError && canManageDomain && (
                              <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                                {ts("lastVerificationError")}: {domain.verificationError}
                              </div>
                            )}

                            {canManageDomain &&
                              expandedDomainIds[domain.id] &&
                              recordsByDomainId[domain.id] && (
                                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                  {recordsByDomainId[domain.id].map((record) => {
                                    const baseKey = `${domain.id}-${record.kind}-${record.name}`
                                    return (
                                      <DnsRecordCard
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
                              )}
                          </div>
                        </Panel>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {/* ====== USERS ====== */}
            {view === "users" && isAdmin && (
              <>
                <SectionHeader
                  title={ta("userPanelTitle")}
                  action={
                    <IconActionButton
                      icon={<RefreshCw size={14} />}
                      label={ta("refreshUsers")}
                      onPress={() => void loadUsers()}
                      isLoading={usersLoading}
                    />
                  }
                />

                <Panel>
                  <PanelHeader title={ta("createUser")} icon={<Users2 size={16} />} />
                  <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
                    <Input
                      label={ta("consoleUsernameLabel")}
                      value={newUsername}
                      onValueChange={setNewUsername}
                      variant="bordered"
                      size="sm"
                      classNames={TM_INPUT_CLASSNAMES}
                    />
                    <Input
                      label={ta("newUserPasswordLabel")}
                      type="password"
                      value={newUserPassword}
                      onValueChange={setNewUserPassword}
                      variant="bordered"
                      size="sm"
                      classNames={TM_INPUT_CLASSNAMES}
                    />
                    <Input
                      label={ta("domainLimitLabel")}
                      type="number"
                      value={newUserDomainLimit}
                      onValueChange={setNewUserDomainLimit}
                      variant="bordered"
                      size="sm"
                      classNames={TM_INPUT_CLASSNAMES}
                    />
                  </div>
                  <div className="px-5 pb-5">
                    <IconActionButton
                      icon={<Plus size={14} />}
                      label={ta("createUser")}
                      className="bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-600 dark:text-white dark:hover:bg-sky-500"
                      onPress={handleCreateUser}
                      isLoading={isCreatingUser}
                    />
                  </div>
                </Panel>

                {/* User list */}
                {adminUsers.length === 0 ? (
                  <EmptyState title={ta("userEmptyTitle")} />
                ) : (
                  <Panel>
                    <div className="divide-y divide-slate-100/80 dark:divide-slate-800/60">
                      {adminUsers.map((user) => (
                        <div key={user.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-900 dark:text-white">
                                {user.username}
                              </span>
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                {user.role}
                              </span>
                              {user.isDisabled && (
                                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400">
                                  disabled
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-400">
                              {ta("domainLimitValue", { count: user.domainLimit })}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <select
                              className="rounded-xl border border-slate-200 bg-white/70 px-2.5 py-1 text-xs text-slate-600 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
                              value={user.role}
                              onChange={(event) =>
                                void handlePatchUser(user, { role: event.target.value as ConsoleUser["role"] })
                              }
                            >
                              <option value="user">{ta("roleUser")}</option>
                              <option value="admin">{ta("roleAdmin")}</option>
                            </select>
                            <IconActionButton
                              icon={<SlidersHorizontal size={13} />}
                              label={ta("editDomainLimit")}
                              onPress={() => void handleEditUserLimit(user)}
                            />
                            <IconActionButton
                              icon={<ShieldAlert size={13} />}
                              label={user.isDisabled ? ta("enableUser") : ta("disableUser")}
                              onPress={() => void handlePatchUser(user, { isDisabled: !user.isDisabled })}
                            />
                            <IconActionButton
                              icon={<KeyRound size={13} />}
                              label={ta("resetUserPassword")}
                              onPress={() => void handleResetUserPassword(user)}
                            />
                            <IconActionButton
                              danger
                              icon={<Trash2 size={13} />}
                              label={tc("delete")}
                              onPress={() => void handleDeleteUser(user)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}
              </>
            )}

            {/* ====== SECURITY ====== */}
            {view === "security" && (
              <>
                <SectionHeader
                  title={ta("securityPanelTitle")}
                />

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.9fr)]">
                  <div className="space-y-6">
                    <Panel>
                      <PanelHeader
                        title={ta("apiKeySettings")}
                        icon={<KeyRound size={16} />}
                        action={
                          <IconActionButton
                            icon={<RefreshCw size={13} />}
                            label={ta("refreshKeys")}
                            onPress={() => void loadAccessKeys()}
                            isLoading={accessKeysLoading}
                          />
                        }
                      />
                      <div className="space-y-4 p-5">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                          <Input
                            label={ta("apiKeyNameLabel")}
                            placeholder={ta("apiKeyNamePlaceholder")}
                            value={newAccessKeyName}
                            onValueChange={setNewAccessKeyName}
                            variant="bordered"
                            size="sm"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                          <div className="flex items-end">
                            <Button
                              size="sm"
                              className="h-10 rounded-2xl bg-sky-600 px-4 text-white hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500"
                              onPress={() => void handleGenerateAdminKey()}
                              isLoading={isCreatingAccessKey}
                              isDisabled={
                                hasReachedAccessKeyLimit ||
                                !hasAdminSession ||
                                isBootstrapping ||
                                accessKeysLoading
                              }
                            >
                              {ta("apiKeyGenerate")}
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200/70 bg-white/55 p-4 text-sm text-slate-600 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35 dark:text-slate-300">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {ta("apiKeyUsageSummary", {
                              count: adminAccessKeys.length,
                              limit: settingsDraft.userLimits.apiKeyLimit,
                            })}
                          </div>
                        </div>

                        {adminAccessKeys.length === 0 ? (
                          <EmptyState title={ta("apiKeyListEmpty")} compact />
                        ) : (
                          <div className="space-y-3">
                            {adminAccessKeys.map((key) => {
                              const hasCopyableKey = Boolean(getVisibleAdminKeyValue(key))

                              return (
                                <div
                                  key={key.id}
                                  className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/55 p-4 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/35 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
                                      {key.name}
                                    </div>
                                    <div className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">
                                      {key.maskedKey}
                                    </div>
                                    <div className="mt-1 text-[11px] text-slate-400">
                                      {ta("keyCreatedAt", {
                                        date: new Date(key.createdAt).toLocaleString(),
                                      })}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      size="sm"
                                      variant="flat"
                                      startContent={<Copy size={13} />}
                                      className={`h-8 rounded-xl px-3 text-xs font-medium ${
                                        hasCopyableKey
                                          ? "bg-slate-100/70 text-slate-700 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-700/70"
                                          : "bg-slate-100/70 text-slate-500 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/70"
                                      }`}
                                      onPress={() => void handleCopyAdminKey(key)}
                                    >
                                      {copiedKeyId === key.id ? tc("copied") : ta("apiKeyCopy")}
                                    </Button>
                                    <IconActionButton
                                      danger
                                      icon={<Trash2 size={13} />}
                                      label={ta("deleteKey")}
                                      onPress={() => void handleDeleteAccessKey(key)}
                                      isLoading={deletingAccessKeyId === key.id}
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </Panel>
                  </div>

                  <div className="space-y-6">
                    <Panel>
                      <PanelHeader title={ta("passwordPanelTitle")} />
                      <div className="space-y-4 p-5">
                        <Input
                          label={ta("currentPasswordLabel")}
                          type="password"
                          value={currentPassword}
                          onValueChange={setCurrentPassword}
                          variant="bordered"
                          size="sm"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Input
                          label={ta("newPasswordLabel")}
                          type="password"
                          value={nextPassword}
                          onValueChange={setNextPassword}
                          variant="bordered"
                          size="sm"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Button
                          size="sm"
                          className="h-10 rounded-2xl bg-sky-600 px-4 text-white hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500"
                          onPress={() => void handleUpdatePassword()}
                          isLoading={isUpdatingPassword}
                        >
                          {ta("updatePasswordSubmit")}
                        </Button>
                      </div>
                    </Panel>
                  </div>
                </div>
              </>
            )}

            {/* ====== LOGS ====== */}
            {view === "logs" && isAdmin && (
              <>
                <SectionHeader
                  title={ta("logsPanelTitle")}
                  action={
                    <div className="flex gap-2">
                      <IconActionButton
                        icon={<RefreshCw size={14} />}
                        label={ta("refreshOps")}
                        onPress={() => void loadOps()}
                        isLoading={logsLoading}
                      />
                      <IconActionButton
                        danger
                        icon={<Trash2 size={14} />}
                        label={ta("clearLogs")}
                        onPress={handleClearAuditLogs}
                        isLoading={isClearingLogs}
                        disabled={adminAuditLogs.length === 0}
                      />
                      <IconActionButton
                        icon={<Sparkles size={14} />}
                        label={ta("runCleanup")}
                        className="bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                        onPress={handleRunCleanup}
                        isLoading={isRunningCleanup}
                      />
                    </div>
                  }
                />
                <Panel>
                  <PanelHeader title={ta("logsPanelTitle")} />
                  <div className="max-h-[32rem] overflow-y-auto p-5">
                    {adminAuditLogs.length === 0 ? (
                      <EmptyState title={ta("logsEmptyTitle")} compact />
                    ) : (
                      <div className="space-y-1">
                        {adminAuditLogs.map((entry) => (
                          <div key={entry} className="font-mono text-xs leading-6 text-slate-600 dark:text-slate-400">
                            {entry}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Panel>
              </>
            )}

                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>

      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
            onClick={() => setIsSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[18rem] max-w-[85vw] bg-transparent p-3">
            <AdminConsoleSidebar
              mobile
              menuItems={menuItems}
              activeView={view}
              onSelectView={(nextView) => {
                void handleSelectView(nextView).then((didNavigate) => {
                  if (didNavigate) {
                    setIsSidebarOpen(false)
                  }
                })
              }}
              currentUser={currentUser}
              serviceStatus={serviceStatus}
              mailboxCount={activeMailboxAccountsCount}
              managedDomainsCount={isAdmin ? managedDomains.length : ownedManagedDomainsCount}
              managedDomainsLimit={!isAdmin ? currentUserManagedDomainLimit : undefined}
              activeDomainsCount={activeDomainsCount}
              pendingDomainsCount={pendingDomainsCount}
              statusLabels={{
                active: ts("domainStatusActive"),
                pending: ts("domainStatusPending"),
              }}
              canUseSensitiveAdminActions={canUseSensitiveAdminActions}
              ta={ta}
              trailingAction={
                <Button
                  isIconOnly
                  variant="light"
                  size="sm"
                  className="text-slate-600 dark:text-slate-300"
                  onPress={() => setIsSidebarOpen(false)}
                  aria-label="Close navigation"
                >
                  <X size={18} />
                </Button>
              }
            />
          </div>
        </div>
      )}

      <Modal
        isOpen={isBatchDomainModalOpen}
        onClose={handleCloseBatchDomainModal}
        placement="center"
        backdrop="blur"
        size="2xl"
        scrollBehavior="inside"
      >
          <ModalContent className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-[0_30px_90px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/92 dark:shadow-none">
          <ModalHeader className="flex flex-col gap-1 border-b border-slate-200/80 px-6 pb-5 pt-6 dark:border-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1" />
              <div className="mb-3 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-emerald-100 dark:bg-emerald-950/50">
                  <Sparkles size={24} className="text-emerald-600 dark:text-emerald-300" />
                </div>
              </div>
              <div className="flex-1" />
            </div>
            <h2 className="text-center text-xl font-semibold text-slate-950 dark:text-white">
              {ts("domainBatchTitle")}
            </h2>
          </ModalHeader>

          <ModalBody className="space-y-4 bg-slate-50/65 px-6 py-5 dark:bg-transparent">
            {cloudflareZoneOptions.length > 0 ? (
              <Select
                label={ts("domainBatchRootLabel")}
                placeholder={ts("domainBatchRootPlaceholder")}
                selectedKeys={batchDomainRootInput ? [batchDomainRootInput] : []}
                onSelectionChange={(keys) => {
                  const [value] = Array.from(keys).map(String)
                  setBatchDomainRootInput(value ?? "")
                }}
                disallowEmptySelection
                isDisabled={cloudflareZonesLoading || isCreatingDomainBatch}
              >
                {cloudflareZoneOptions.map((zone) => (
                  <SelectItem key={zone} textValue={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </Select>
            ) : (
              <div className="rounded-[1.5rem] border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {cloudflareZonesLoading
                        ? ts("cloudflareZoneLoading")
                        : cloudflareZoneLoadError
                          ? ts("cloudflareZoneLoadFailed")
                          : !canBatchCreateManagedDomains
                            ? ts("domainBatchRequiresCloudflare")
                            : cloudflareZonesRequireApiUpdate
                              ? ts("cloudflareZoneApiOutdated")
                              : ts("domainBatchNoSecondLevelDomain")}
                    </div>
                  </div>

                  {canBatchCreateManagedDomains ? (
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={
                        cloudflareZonesLoading ? <Spinner size="sm" /> : <RefreshCw size={14} />
                      }
                      className="h-10 rounded-2xl bg-slate-100/90 px-4 text-slate-700 hover:bg-slate-200/90 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-700/80"
                      onPress={() => void loadBatchCloudflareZones()}
                      isDisabled={cloudflareZonesLoading}
                    >
                      {ts("cloudflareZoneRefresh")}
                    </Button>
                  ) : null}
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label={ts("domainBatchPrefixLabel")}
                placeholder={ts("domainBatchPrefixPlaceholder")}
                value={batchDomainPrefixInput}
                onValueChange={setBatchDomainPrefixInput}
                variant="bordered"
                size="sm"
                classNames={TM_INPUT_CLASSNAMES}
                isDisabled={isCreatingDomainBatch}
              />
              <Input
                label={ts("domainBatchRandomLengthLabel")}
                type="number"
                value={batchDomainRandomLengthInput}
                onValueChange={setBatchDomainRandomLengthInput}
                min={MIN_BATCH_DOMAIN_RANDOM_LENGTH}
                max={MAX_BATCH_DOMAIN_RANDOM_LENGTH}
                variant="bordered"
                size="sm"
                classNames={TM_INPUT_CLASSNAMES}
                isDisabled={isCreatingDomainBatch}
              />
            </div>

            <Input
              label={ts("domainBatchCountLabel")}
              type="number"
              value={batchDomainCountInput}
              onValueChange={setBatchDomainCountInput}
              min={1}
              max={MAX_BATCH_MANAGED_DOMAINS}
              variant="bordered"
              size="sm"
              classNames={TM_INPUT_CLASSNAMES}
              isDisabled={isCreatingDomainBatch}
            />

            {batchDomainProgress ? (
              <div className="rounded-[1.5rem] border border-emerald-200/80 bg-emerald-50/80 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                      {ts("domainBatchProgressLabel")}
                    </p>
                    <p className="text-xs text-emerald-700/80 dark:text-emerald-200/80">
                      {ts("domainBatchProgressRunning", {
                        current: batchDomainCurrentIndex,
                        total: batchDomainProgress.total,
                      })}
                    </p>
                  </div>
                  <div className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm dark:bg-slate-900/70 dark:text-emerald-200">
                    {batchDomainProgress.completed}/{batchDomainProgress.total}
                  </div>
                </div>

                <Progress
                  value={batchDomainProgressPercent}
                  className="mt-3 h-2 bg-emerald-100 dark:bg-emerald-950/60"
                />

                {batchDomainProgress.currentDomain ? (
                  <p className="mt-3 break-all font-mono text-xs text-emerald-900 dark:text-emerald-100">
                    {ts("domainBatchProgressCurrent", {
                      domain: batchDomainProgress.currentDomain,
                    })}
                  </p>
                ) : null}

                <p className="mt-2 text-xs leading-6 text-emerald-700/90 dark:text-emerald-200/90">
                  {ts("domainBatchProgressStats", {
                    created: batchDomainProgress.created,
                    synced: batchDomainProgress.synced,
                    failed: batchDomainProgress.failed,
                  })}
                </p>
              </div>
            ) : null}
          </ModalBody>

          <ModalFooter className="border-t border-slate-200/80 px-6 py-5 dark:border-slate-800">
            <Button
              variant="flat"
              className="rounded-full"
              onPress={handleCloseBatchDomainModal}
              isDisabled={isCreatingDomainBatch}
            >
              {tc("cancel")}
            </Button>
            <Button
              className="rounded-full bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              onPress={() => void handleCreateRandomDomainBatch()}
              isLoading={isCreatingDomainBatch}
              startContent={<Sparkles size={14} />}
              isDisabled={
                isCreatingDomainBatch ||
                cloudflareZonesLoading ||
                cloudflareZoneOptions.length === 0
              }
            >
              {ts("domainBatchCreateAction")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConsoleActionModal
        isOpen={Boolean(actionDialog)}
        onClose={closeActionDialog}
        onConfirm={handleActionDialogConfirm}
        title={actionDialog?.title ?? ""}
        description={actionDialog?.description}
        cancelLabel={tc("cancel")}
        confirmLabel={actionDialog?.confirmLabel ?? tc("save")}
        tone={actionDialog?.tone ?? "primary"}
        inputLabel={actionDialog?.kind === "input" ? actionDialog.inputLabel : undefined}
        inputType={actionDialog?.kind === "input" ? actionDialog.inputType : undefined}
        inputValue={actionDialog?.kind === "input" ? actionDialog.value : undefined}
        inputPlaceholder={
          actionDialog?.kind === "input" ? actionDialog.inputPlaceholder : undefined
        }
        inputMode={actionDialog?.kind === "input" ? actionDialog.inputMode : undefined}
        errorMessage={actionDialogError}
        onInputValueChange={
          actionDialog?.kind === "input" ? handleActionDialogValueChange : undefined
        }
      />
    </div>
  )
}

/* ================================================================
   Shared UI primitives
   ================================================================ */

function AdminConsoleSidebar({
  mobile,
  menuItems,
  activeView,
  onSelectView,
  currentUser,
  serviceStatus,
  mailboxCount,
  managedDomainsCount,
  managedDomainsLimit,
  activeDomainsCount,
  pendingDomainsCount,
  statusLabels,
  canUseSensitiveAdminActions,
  ta,
  trailingAction,
}: {
  mobile?: boolean
  menuItems: Array<{
    id: ConsoleView
    label: string
    icon: typeof Server
  }>
  activeView: ConsoleView
  onSelectView: (view: ConsoleView) => void | Promise<boolean>
  currentUser: NonNullable<AdminSessionInfo["user"]>
  serviceStatus: {
    status: "ready" | "degraded" | "offline"
    storeBackend?: string
  } | null
  mailboxCount: number
  managedDomainsCount: number
  managedDomainsLimit?: number
  activeDomainsCount: number
  pendingDomainsCount: number
  statusLabels: {
    active: string
    pending: string
  }
  canUseSensitiveAdminActions: boolean
  ta: ReturnType<typeof useTranslations>
  trailingAction?: ReactNode
}) {
  const { brandName } = useBranding()
  const consolePanelTitle = useMemo(
    () => replaceBrandNameText(ta("consolePanelTitle"), brandName),
    [brandName, ta],
  )
  const serviceStatusLabel =
    serviceStatus?.status === "ready"
      ? ta("serviceStatusGood")
      : serviceStatus?.status === "offline"
        ? ta("serviceStatusError")
        : ta("serviceStatusWarning")
  const serviceTone =
    serviceStatus?.status === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/35 dark:text-emerald-200"
      : serviceStatus?.status === "offline"
        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/35 dark:text-rose-200"
        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-200"
  const sidebarStats = [
    {
      key: "mailboxes",
      icon: Inbox,
      label: ta("menuMailboxes"),
      value: mailboxCount,
    },
    {
      key: "active",
      icon: Check,
      label: statusLabels.active,
      value: activeDomainsCount,
    },
    {
      key: "pending",
      icon: Globe2,
      label: statusLabels.pending,
      value: pendingDomainsCount,
    },
  ]
  const primaryMenuItems = menuItems.filter((item) => item.id !== "settings")
  const pinnedMenuItem = menuItems.find((item) => item.id === "settings") ?? null

  const renderSidebarMenuButton = (item: (typeof menuItems)[number], compact = false) => {
    const Icon = item.icon
    const active = activeView === item.id

    if (!mobile) {
      return (
        <TooltipProvider key={item.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={active ? "flat" : "light"}
                color={active ? "primary" : "default"}
                aria-label={item.label}
                title={item.label}
                className={`w-full rounded-2xl px-3 py-2 transition-all duration-150 ${
                  compact ? "h-12" : "h-[4.9rem]"
                } ${
                  active
                    ? "bg-sky-100 text-sky-900 shadow-sm dark:bg-sky-950/40 dark:text-sky-100"
                    : "bg-white/65 text-slate-700 hover:bg-white/85 dark:bg-slate-950/45 dark:text-slate-300 dark:hover:bg-slate-900/80"
                }`}
                onPress={() => void onSelectView(item.id)}
              >
                {compact ? (
                  <div className="flex w-full items-center justify-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
                        active
                          ? "bg-white/90 text-sky-700 dark:bg-sky-900/60 dark:text-sky-100"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400"
                      }`}
                    >
                      <Icon size={18} />
                    </div>
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                ) : (
                  <div className="flex w-full flex-col items-center justify-center gap-1.5">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
                        active
                          ? "bg-white/90 text-sky-700 dark:bg-sky-900/60 dark:text-sky-100"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400"
                      }`}
                    >
                      <Icon size={18} />
                    </div>
                    <span className="line-clamp-1 text-center text-[11px] font-medium leading-4">
                      {item.label}
                    </span>
                  </div>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }

    return (
      <Button
        key={item.id}
        variant={active ? "flat" : "light"}
        color={active ? "primary" : "default"}
        className={`w-full justify-start rounded-2xl transition-all duration-150 ${
          active
            ? "h-12 bg-sky-100 text-sky-900 shadow-sm dark:bg-sky-950/40 dark:text-sky-100"
            : "h-11 text-slate-700 hover:bg-white/85 dark:text-slate-300 dark:hover:bg-slate-900/80"
        }`}
        startContent={
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
              active
                ? "bg-white/90 text-sky-700 dark:bg-sky-900/60 dark:text-sky-100"
                : "bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400"
            }`}
          >
            <Icon size={18} />
          </div>
        }
        onPress={() => void onSelectView(item.id)}
      >
        {item.label}
      </Button>
    )
  }

  return (
    <div
      className={`flex h-full ${mobile ? "w-full" : "w-72"} flex-col overflow-hidden rounded-[2rem] border border-white/65 bg-white/80 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/70 dark:shadow-none`}
    >
      <div className="border-b border-slate-200/80 px-5 py-5 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
            <Sparkles size={13} />
            {brandName}
          </div>
          {trailingAction}
        </div>

        <div className="mt-4 rounded-[1.6rem] border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-sky-50/70 p-4 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-sky-950/20">
          <div className="tm-section-label">{ta("serviceStatus")}</div>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                {currentUser.username}
              </div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {consolePanelTitle}
              </div>
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${getConsoleRoleBadgeClassName(currentUser.role)}`}>
              <Users2 size={12} />
              {currentUser.role === "admin" ? ta("roleAdmin") : ta("roleUser")}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${serviceTone}`}>
              <Activity size={12} />
              {serviceStatusLabel}
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300">
              <Globe2 size={12} />
              {ta("managedDomainCount")}{" "}
              {managedDomainsLimit !== undefined
                ? `${managedDomainsCount}/${managedDomainsLimit}`
                : managedDomainsCount}
            </div>
          </div>

          {!canUseSensitiveAdminActions && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
              <ShieldAlert size={12} />
              {ta("insecureContextTitle")}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          {sidebarStats.map((stat) => {
            const Icon = stat.icon
            return (
              <TooltipProvider key={stat.key}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-3 dark:border-slate-800 dark:bg-slate-950/80">
                      <div className="flex items-center justify-center">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                          <Icon size={15} />
                        </div>
                      </div>
                      <div className="mt-2 text-center text-sm font-semibold text-slate-950 dark:text-white">
                        {stat.value}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side={mobile ? "top" : "right"}>{stat.label}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          })}
        </div>
      </div>

      <div className="flex flex-1 flex-col border-t border-slate-200/80 px-4 pb-4 pt-4 dark:border-slate-800">
        <div>
          <div className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
            {ta("inventoryTitle")}
          </div>
          <div className={mobile ? "space-y-2" : "grid grid-cols-2 gap-2"}>
            {primaryMenuItems.map((item) => renderSidebarMenuButton(item))}
          </div>
        </div>

        {pinnedMenuItem ? (
          <div className="mt-auto border-t border-slate-200/80 pt-4 dark:border-slate-800">
            <div className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              {pinnedMenuItem.label}
            </div>
            {renderSidebarMenuButton(pinnedMenuItem, true)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-medium text-slate-900 dark:text-white">{title}</h2>
      </div>
      {action}
    </div>
  )
}

function Panel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`overflow-hidden rounded-[1.25rem] border border-white/60 bg-white/70 shadow-[0_4px_24px_rgba(15,23,42,0.05)] backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-950/60 dark:shadow-none ${className ?? ""}`}>
      {children}
    </div>
  )
}

function PanelHeader({
  title,
  icon,
  action,
}: {
  title: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100/80 px-5 py-3.5 dark:border-slate-800/60">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        {icon}
        {title}
      </div>
      {action}
    </div>
  )
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  progressPercent,
}: {
  label: string
  value: string
  detail?: string
  tone: MetricCardTone
  progressPercent?: number
}) {
  const valueColor =
    tone === "success"
      ? "text-green-700 dark:text-green-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "danger"
          ? "text-red-600 dark:text-red-400"
          : "text-slate-900 dark:text-white"

  const accentBorder =
    tone === "success"
      ? "border-l-2 border-l-emerald-400 dark:border-l-emerald-500"
      : tone === "warning"
        ? "border-l-2 border-l-amber-400 dark:border-l-amber-500"
        : tone === "danger"
          ? "border-l-2 border-l-red-400 dark:border-l-red-500"
          : ""
  const progressColor =
    tone === "success"
      ? "bg-emerald-500"
      : tone === "warning"
        ? "bg-amber-500"
        : tone === "danger"
          ? "bg-red-500"
          : "bg-slate-700 dark:bg-slate-300"
  const progressWidth =
    typeof progressPercent === "number" && Number.isFinite(progressPercent)
      ? `${Math.max(0, Math.min(100, progressPercent))}%`
      : null

  return (
    <div className={`flex h-full min-h-[132px] flex-col rounded-[1.25rem] border border-white/60 bg-white/65 px-4 py-3.5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-white/80 hover:shadow-md dark:border-slate-800/70 dark:bg-slate-950/55 dark:hover:bg-slate-950/70 ${accentBorder}`}>
      <div className="text-xs font-medium text-slate-400 dark:text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${valueColor}`}>{value}</div>
      <div className="mt-auto pt-4">
        {detail && (
          <div className="text-xs text-slate-500 dark:text-slate-400">{detail}</div>
        )}
        {progressWidth && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${progressColor}`}
              style={{ width: progressWidth }}
            />
          </div>
        )}
      </div>
    </div>
  )
}


function StatusBadge({
  active,
  activeLabel,
  pendingLabel,
}: {
  active: boolean
  activeLabel: string
  pendingLabel: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        active
          ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
      }`}
    >
      {active ? activeLabel : pendingLabel}
    </span>
  )
}

function IconActionButton({
  icon,
  label,
  tooltip,
  danger,
  disabled,
  isLoading,
  onPress,
  className,
}: {
  icon: ReactNode
  label: string
  tooltip?: string
  danger?: boolean
  disabled?: boolean
  isLoading?: boolean
  onPress?: () => void
  className?: string
}) {
  const button = (
    <Button
      isIconOnly
      size="sm"
      variant="flat"
      aria-label={label}
      title={tooltip ?? label}
      className={`h-8 w-8 min-w-0 rounded-lg transition-all duration-150 active:scale-[0.97] ${
        danger
          ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
          : "bg-slate-100/70 text-slate-600 hover:bg-slate-200/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/60"
      } ${className ?? ""}`}
      isDisabled={disabled}
      isLoading={isLoading}
      onPress={onPress}
    >
      {icon}
    </Button>
  )

  if (!tooltip) {
    return button
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function EmptyState({
  title,
  description,
  compact,
}: {
  title: string
  description?: string
  compact?: boolean
}) {
  return (
    <div className={`rounded-[1.25rem] border border-dashed border-slate-300/60 text-center dark:border-slate-700/60 ${compact ? "px-4 py-6" : "px-6 py-10"}`}>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</div>
      {description ? (
        <div className="mt-2 text-sm leading-6 text-slate-400 dark:text-slate-500">
          {description}
        </div>
      ) : null}
    </div>
  )
}

function DnsRecordCard({
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
    <div className="rounded-[1.25rem] border border-slate-200/60 bg-gradient-to-br from-slate-50/80 to-white p-4 backdrop-blur-sm dark:border-slate-700/50 dark:from-slate-800/40 dark:to-slate-900/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          {record.kind}
        </span>
        <span className="text-[11px] text-slate-400">TTL {record.ttl}</span>
      </div>

      <div className="mt-3 space-y-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{labels.host}</div>
          <div className="mt-0.5 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{record.name}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{labels.value}</div>
          <div className="mt-0.5 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{record.value}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <IconActionButton
          icon={<Copy size={11} />}
          label={copiedTarget === `${copyStatePrefix}-host` ? copiedLabel : labels.host}
          onPress={() => onCopy(record.name, "host")}
        />
        <IconActionButton
          icon={<Copy size={11} />}
          label={copiedTarget === `${copyStatePrefix}-value` ? copiedLabel : labels.value}
          onPress={() => onCopy(record.value, "value")}
        />
        <IconActionButton
          icon={<Copy size={11} />}
          label={copiedTarget === `${copyStatePrefix}-record` ? copiedLabel : labels.copyRecord}
          onPress={() => onCopy(fullRecord, "record")}
        />
      </div>
    </div>
  )
}
