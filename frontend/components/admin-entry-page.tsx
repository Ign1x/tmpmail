"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Button } from "@heroui/button"
import {
  ChevronRight,
  Globe2,
  KeyRound,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users2,
  UserPlus,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import {
  getLinuxDoAuthorizationUrl,
  getAdminStatus,
  loginAdmin,
  registerConsole,
  recoverAdmin,
  restoreAdminSessionInfo,
  sendConsoleRegisterOtp,
  setupAdminPassword,
  type AdminStatus,
} from "@/lib/api"
import { TM_INPUT_CLASSNAMES } from "@/components/heroui-field-styles"
import { Input } from "@/components/tm-form-fields"
import {
  clearStoredAdminSession,
  hasStoredAdminSession,
  setStoredAdminSession,
  storePendingAdminSession,
  storePendingRevealedAdminKey,
} from "@/lib/admin-session"
import { validateEmailAddress } from "@/lib/account-validation"
import { useBranding } from "@/contexts/branding-context"
import BrandMark from "@/components/brand-mark"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"
import { replaceBrowserPath } from "@/lib/admin-entry"
import { replaceBrandNameText } from "@/lib/site-branding"

const ADMIN_KEY_VISIBLE_MS = 60_000
const LINUX_DO_DEFAULT_CALLBACK_PATH = "/auth/linux-do"
const LINUX_DO_STATE_STORAGE_KEY = "tmpmail-linux-do-oauth-state"
const LINUX_DO_INVITE_CODE_STORAGE_KEY = "tmpmail-linux-do-invite-code"
const LINUX_DO_PENDING_TOKEN_STORAGE_KEY = "tmpmail-linux-do-pending-token"
const LINUX_DO_REDIRECT_URI_STORAGE_KEY = "tmpmail-linux-do-redirect-uri"
const LINUX_DO_RETURN_PATH_STORAGE_KEY = "tmpmail-linux-do-return-path"

type EntryMode = "register" | "login"

interface AdminEntryPageProps {
  consolePath: string
  requireSecureTransport: boolean
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

function getErrorDescription(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

function generateLinuxDoState(): string {
  const bytes = new Uint8Array(24)

  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}

export default function AdminEntryPage({
  consolePath,
  requireSecureTransport,
}: AdminEntryPageProps) {
  const { toast } = useHeroUIToast()
  const { brandName } = useBranding()
  const ta = useTranslations("admin")

  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [setupUsername, setSetupUsername] = useState("admin")
  const [setupPassword, setSetupPassword] = useState("")
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState("")
  const [loginIdentifier, setLoginIdentifier] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [registerEmail, setRegisterEmail] = useState("")
  const [registerPassword, setRegisterPassword] = useState("")
  const [registerOtpCode, setRegisterOtpCode] = useState("")
  const [registerInviteCode, setRegisterInviteCode] = useState("")
  const [recoveryToken, setRecoveryToken] = useState("")
  const [recoveryUsername, setRecoveryUsername] = useState("admin")
  const [recoveryPassword, setRecoveryPassword] = useState("")
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState("")
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false)
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false)
  const [isSubmittingLinuxDo, setIsSubmittingLinuxDo] = useState(false)
  const [isSubmittingRegister, setIsSubmittingRegister] = useState(false)
  const [isSendingRegisterOtp, setIsSendingRegisterOtp] = useState(false)
  const [isSubmittingRecovery, setIsSubmittingRecovery] = useState(false)
  const [registerOtpCooldown, setRegisterOtpCooldown] = useState(0)
  const [isSecureAdminContext, setIsSecureAdminContext] = useState(() => !requireSecureTransport)
  const [isRestoringSession, setIsRestoringSession] = useState(false)
  const [entryMode, setEntryMode] = useState<EntryMode>("login")
  const [showRecovery, setShowRecovery] = useState(false)
  const hasBootstrappedRef = useRef(false)
  const isMountedRef = useRef(true)

  const needsSetup = status?.isBootstrapRequired ?? true
  const canRegister = status?.openRegistrationEnabled ?? false
  const inviteCodeRequired = status?.consoleInviteCodeRequired ?? false
  const emailOtpEnabled = status?.emailOtpEnabled ?? false
  const canUseLinuxDo = canRegister && (status?.linuxDoEnabled ?? false)
  const canUseSensitiveAdminActions = !requireSecureTransport || isSecureAdminContext
  const redirectToConsole = useCallback(() => {
    replaceBrowserPath(consolePath)
  }, [consolePath])

  useEffect(() => {
    setIsSecureAdminContext(!requireSecureTransport || isTrustedAdminContext())
  }, [requireSecureTransport])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!status?.isRecoveryEnabled) {
      setShowRecovery(false)
    }
  }, [status?.isRecoveryEnabled])

  useEffect(() => {
    if (!canRegister && entryMode === "register") {
      setEntryMode("login")
    }
  }, [canRegister, entryMode])

  useEffect(() => {
    if (!emailOtpEnabled) {
      setRegisterOtpCode("")
      setRegisterOtpCooldown(0)
    }
  }, [emailOtpEnabled])

  useEffect(() => {
    if (!inviteCodeRequired) {
      setRegisterInviteCode("")
    }
  }, [inviteCodeRequired])

  useEffect(() => {
    if (registerOtpCooldown <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setRegisterOtpCooldown((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [registerOtpCooldown])

  useEffect(() => {
    if (hasBootstrappedRef.current) {
      return
    }
    hasBootstrappedRef.current = true

    const bootstrap = async () => {
      setIsBootstrapping(true)
      const hasStoredSession = hasStoredAdminSession()
      const canRestoreSession =
        hasStoredSession && (!requireSecureTransport || isTrustedAdminContext())

      try {
        if (canRestoreSession) {
          if (isMountedRef.current) {
            setIsRestoringSession(true)
          }

          try {
            await restoreAdminSessionInfo(DEFAULT_PROVIDER_ID)
            if (!isMountedRef.current) {
              return
            }

            setStoredAdminSession()
            redirectToConsole()
            return
          } catch (error) {
            clearStoredAdminSession()
            if (!isMountedRef.current) {
              return
            }

            toast({
              title: ta("sessionRestoreFailed"),
              description: getErrorDescription(error, ta("statusLoadFailedDesc")),
              color: "warning",
              variant: "flat",
            })
          } finally {
            if (isMountedRef.current) {
              setIsRestoringSession(false)
            }
          }
        }

        const nextStatus = await getAdminStatus(DEFAULT_PROVIDER_ID)
        if (!isMountedRef.current) {
          return
        }
        setStatus(nextStatus)
      } catch (error) {
        if (!isMountedRef.current) {
          return
        }

        toast({
          title: ta("statusLoadFailed"),
          description: getErrorDescription(error, ta("statusLoadFailedDesc")),
          color: "danger",
          variant: "flat",
        })
      } finally {
        if (isMountedRef.current) {
          setIsBootstrapping(false)
        }
      }
    }

    void bootstrap()
  }, [redirectToConsole, requireSecureTransport, ta, toast])

  const enterConsole = (apiKey?: string) => {
    setStoredAdminSession()
    if (apiKey?.trim()) {
      storePendingRevealedAdminKey(apiKey, ADMIN_KEY_VISIBLE_MS)
    }

    redirectToConsole()
  }

  const handleSetupAdmin = async () => {
    if (!canUseSensitiveAdminActions) {
      toast({
        title: ta("secureContextRequired"),
        description: ta("secureContextRequiredDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (!setupUsername.trim()) {
      toast({ title: ta("consoleUsernameRequired"), color: "warning", variant: "flat" })
      return
    }

    if (setupPassword.trim().length < 10) {
      toast({ title: ta("passwordTooShort"), color: "warning", variant: "flat" })
      return
    }

    if (setupPassword !== setupPasswordConfirm) {
      toast({ title: ta("passwordMismatch"), color: "warning", variant: "flat" })
      return
    }

    setIsSubmittingSetup(true)

    try {
      const response = await setupAdminPassword(
        {
          username: setupUsername.trim(),
          password: setupPassword,
        },
        DEFAULT_PROVIDER_ID,
      )
      if (!isMountedRef.current) {
        return
      }
      storePendingAdminSession(response.session)
      setSetupPassword("")
      setSetupPasswordConfirm("")
      toast({
        title: ta("setupSuccess"),
        description: ta("setupSuccessDescription"),
        color: "success",
        variant: "flat",
      })
      enterConsole(response.apiKey)
    } catch (error) {
      clearStoredAdminSession()
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
    if (!canUseSensitiveAdminActions) {
      toast({
        title: ta("secureContextRequired"),
        description: ta("secureContextRequiredDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (!loginIdentifier.trim()) {
      toast({ title: ta("loginIdentityRequired"), color: "warning", variant: "flat" })
      return
    }

    if (!loginPassword.trim()) {
      toast({ title: ta("loginPasswordRequired"), color: "warning", variant: "flat" })
      return
    }

    setIsSubmittingLogin(true)

    try {
      const response = await loginAdmin(
        {
          username: loginIdentifier.trim(),
          password: loginPassword,
        },
        DEFAULT_PROVIDER_ID,
      )
      if (!isMountedRef.current) {
        return
      }
      storePendingAdminSession(response.session)
      setLoginPassword("")
      toast({
        title: ta("sessionReady"),
        color: "success",
        variant: "flat",
      })
      enterConsole()
    } catch (error) {
      clearStoredAdminSession()
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

  const handleLinuxDoAuth = async () => {
    if (!canUseSensitiveAdminActions) {
      toast({
        title: ta("secureContextRequired"),
        description: ta("secureContextRequiredDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (!canUseLinuxDo) {
      toast({
        title: ta("linuxDoUnavailable"),
        description: ta("linuxDoUnavailableDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (typeof window === "undefined") {
      return
    }

    setIsSubmittingLinuxDo(true)

    try {
      const state = generateLinuxDoState()
      sessionStorage.setItem(LINUX_DO_STATE_STORAGE_KEY, state)
      sessionStorage.removeItem(LINUX_DO_PENDING_TOKEN_STORAGE_KEY)
      sessionStorage.setItem(LINUX_DO_RETURN_PATH_STORAGE_KEY, consolePath)
      if (registerInviteCode.trim()) {
        sessionStorage.setItem(LINUX_DO_INVITE_CODE_STORAGE_KEY, registerInviteCode.trim())
      } else {
        sessionStorage.removeItem(LINUX_DO_INVITE_CODE_STORAGE_KEY)
      }
      const redirectUri =
        status?.linuxDoCallbackUrl?.trim() ||
        new URL(LINUX_DO_DEFAULT_CALLBACK_PATH, window.location.origin).toString()
      sessionStorage.setItem(LINUX_DO_REDIRECT_URI_STORAGE_KEY, redirectUri)
      const response = await getLinuxDoAuthorizationUrl(
        redirectUri,
        state,
        registerInviteCode.trim() || undefined,
        DEFAULT_PROVIDER_ID,
      )
      window.location.assign(response.authorizationUrl)
    } catch (error) {
      try {
        sessionStorage.removeItem(LINUX_DO_STATE_STORAGE_KEY)
        sessionStorage.removeItem(LINUX_DO_INVITE_CODE_STORAGE_KEY)
        sessionStorage.removeItem(LINUX_DO_PENDING_TOKEN_STORAGE_KEY)
        sessionStorage.removeItem(LINUX_DO_REDIRECT_URI_STORAGE_KEY)
        sessionStorage.removeItem(LINUX_DO_RETURN_PATH_STORAGE_KEY)
      } catch {}

      toast({
        title: ta("linuxDoUnavailable"),
        description: getErrorDescription(error, ta("linuxDoUnavailableDescription")),
        color: "danger",
        variant: "flat",
      })
      setIsSubmittingLinuxDo(false)
    }
  }

  const handleRegisterConsole = async () => {
    if (!canUseSensitiveAdminActions) {
      toast({
        title: ta("secureContextRequired"),
        description: ta("secureContextRequiredDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (!canRegister) {
      toast({
        title: ta("registrationClosed"),
        description: ta("registrationClosedDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    const normalizedEmail = registerEmail.trim().toLowerCase()
    if (validateEmailAddress(normalizedEmail)) {
      toast({ title: ta("registerEmailInvalid"), color: "warning", variant: "flat" })
      return
    }

    if (inviteCodeRequired && !registerInviteCode.trim()) {
      toast({ title: ta("registerInviteCodeRequired"), color: "warning", variant: "flat" })
      return
    }

    if (emailOtpEnabled && !registerOtpCode.trim()) {
      toast({ title: ta("registerOtpRequired"), color: "warning", variant: "flat" })
      return
    }

    if (registerPassword.trim().length < 10) {
      toast({ title: ta("passwordTooShort"), color: "warning", variant: "flat" })
      return
    }

    setIsSubmittingRegister(true)

    try {
      const response = await registerConsole(
        {
          email: normalizedEmail,
          password: registerPassword,
          otpCode: emailOtpEnabled ? registerOtpCode.trim() : undefined,
          inviteCode: inviteCodeRequired ? registerInviteCode.trim() : undefined,
        },
        DEFAULT_PROVIDER_ID,
      )
      if (!isMountedRef.current) {
        return
      }
      storePendingAdminSession(response.session)
      setRegisterPassword("")
      setRegisterOtpCode("")
      setRegisterInviteCode("")
      setEntryMode("login")
      toast({
        title: ta("registerSuccess"),
        description: replaceBrandNameText(ta("registerSuccessDescription"), brandName),
        color: "success",
        variant: "flat",
      })
      enterConsole()
    } catch (error) {
      clearStoredAdminSession()
      toast({
        title: ta("registerFailed"),
        description: getErrorDescription(error, ta("registerFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsSubmittingRegister(false)
    }
  }

  const handleSendRegisterOtp = async () => {
    if (!canUseSensitiveAdminActions) {
      toast({
        title: ta("secureContextRequired"),
        description: ta("secureContextRequiredDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (!emailOtpEnabled) {
      return
    }

    const normalizedEmail = registerEmail.trim().toLowerCase()
    if (validateEmailAddress(normalizedEmail)) {
      toast({ title: ta("registerEmailInvalid"), color: "warning", variant: "flat" })
      return
    }

    if (inviteCodeRequired && !registerInviteCode.trim()) {
      toast({ title: ta("registerInviteCodeRequired"), color: "warning", variant: "flat" })
      return
    }

    setIsSendingRegisterOtp(true)

    try {
      const response = await sendConsoleRegisterOtp(
        {
          email: normalizedEmail,
          inviteCode: inviteCodeRequired ? registerInviteCode.trim() : undefined,
        },
        DEFAULT_PROVIDER_ID,
      )
      setRegisterOtpCooldown(response.cooldownSeconds)
      toast({
        title: ta("registerOtpSent"),
        description: ta("registerOtpSentDescription", { seconds: response.expiresInSeconds }),
        color: "success",
        variant: "flat",
      })
    } catch (error) {
      toast({
        title: ta("registerOtpSendFailed"),
        description: getErrorDescription(error, ta("registerOtpSendFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsSendingRegisterOtp(false)
    }
  }

  const handleRecoverAdmin = async () => {
    if (!canUseSensitiveAdminActions) {
      toast({
        title: ta("secureContextRequired"),
        description: ta("secureContextRequiredDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (!status?.isRecoveryEnabled) {
      toast({
        title: ta("recoveryUnavailable"),
        description: ta("recoveryUnavailableDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (!recoveryToken.trim()) {
      toast({ title: ta("recoveryTokenRequired"), color: "warning", variant: "flat" })
      return
    }

    if (!recoveryUsername.trim()) {
      toast({ title: ta("consoleUsernameRequired"), color: "warning", variant: "flat" })
      return
    }

    if (recoveryPassword.trim().length < 10) {
      toast({ title: ta("passwordTooShort"), color: "warning", variant: "flat" })
      return
    }

    if (recoveryPassword !== recoveryPasswordConfirm) {
      toast({ title: ta("passwordMismatch"), color: "warning", variant: "flat" })
      return
    }

    setIsSubmittingRecovery(true)

    try {
      const response = await recoverAdmin(
        {
          recoveryToken: recoveryToken.trim(),
          username: recoveryUsername.trim(),
          newPassword: recoveryPassword,
        },
        DEFAULT_PROVIDER_ID,
      )
      if (!isMountedRef.current) {
        return
      }
      storePendingAdminSession(response.session)
      setRecoveryToken("")
      setRecoveryPassword("")
      setRecoveryPasswordConfirm("")
      setLoginPassword("")
      setStatus((currentStatus) =>
        currentStatus
          ? { ...currentStatus, isBootstrapRequired: false }
          : {
              isBootstrapRequired: false,
              usersTotal: 1,
              adminUsersTotal: 1,
              isRecoveryEnabled: true,
              systemEnabled: true,
              openRegistrationEnabled: false,
              linuxDoEnabled: false,
              emailOtpEnabled: false,
              consoleInviteCodeRequired: false,
            },
      )
      toast({
        title: ta("recoverySuccess"),
        description: ta("recoverySuccessDescription"),
        color: "success",
        variant: "flat",
      })
      enterConsole(response.apiKey)
    } catch (error) {
      clearStoredAdminSession()
      toast({
        title: ta("recoveryFailed"),
        description: getErrorDescription(error, ta("recoveryFailedDescription")),
        color: "danger",
        variant: "flat",
      })
    } finally {
      setIsSubmittingRecovery(false)
    }
  }

  const workspaceSignals = [
    {
      icon: ShieldCheck,
      label: canUseSensitiveAdminActions ? ta("secureContextReadyHint") : ta("insecureContextTitle"),
      tone:
        "border-sky-200/80 bg-sky-50/85 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100",
    },
    {
      icon: Globe2,
      label: canRegister ? ta("openRegistrationOn") : ta("openRegistrationOff"),
      tone:
        canRegister
          ? "border-emerald-200/80 bg-emerald-50/85 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
          : "border-slate-200/80 bg-white/80 text-slate-700 dark:border-slate-800 dark:bg-slate-950/55 dark:text-slate-200",
    },
    {
      icon: KeyRound,
      label: canUseLinuxDo ? ta("linuxDoEnabledOn") : ta("linuxDoEnabledOff"),
      tone:
        canUseLinuxDo
          ? "border-emerald-200/80 bg-emerald-50/85 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
          : "border-slate-200/80 bg-white/80 text-slate-700 dark:border-slate-800 dark:bg-slate-950/55 dark:text-slate-200",
    },
  ]

  const workspaceFeatures = [
    {
      icon: Mail,
      title: ta("consoleFeatureDomains"),
    },
    {
      icon: Users2,
      title: ta("consoleFeatureUsers"),
    },
    {
      icon: Sparkles,
      title: ta("consoleFeatureSystem"),
    },
  ]

  const isRegisterMode = !needsSetup && canRegister && entryMode === "register"
  const authTitle = needsSetup
    ? ta("setupSubmit")
    : isRegisterMode
      ? ta("registerTab")
      : ta("loginTab")

  return (
    <div className="tm-page-backdrop relative min-h-screen overflow-hidden px-4 text-slate-900 dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_16%,rgba(14,165,233,0.18),transparent_22%),radial-gradient(circle_at_82%_12%,rgba(251,191,36,0.12),transparent_20%),radial-gradient(circle_at_65%_70%,rgba(45,212,191,0.12),transparent_24%)] dark:bg-[radial-gradient(circle_at_12%_16%,rgba(56,189,248,0.15),transparent_22%),radial-gradient(circle_at_82%_12%,rgba(15,23,42,0.42),transparent_22%),radial-gradient(circle_at_65%_70%,rgba(20,184,166,0.12),transparent_26%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.16)_1px,transparent_1px)] bg-[size:40px_40px] opacity-[0.2] dark:bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)]" />

      <div className="relative flex min-h-[100svh] items-center py-6 sm:py-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,30rem)] lg:items-stretch"
        >
          <section className="tm-glass-panel-strong flex h-full flex-col overflow-hidden rounded-[2.4rem] p-6 sm:p-8 lg:p-10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tm-chip-strong">
                <Sparkles size={14} />
                {ta("workspaceEntry")}
              </span>
              <span className="tm-chip">{ta("entryBadge")}</span>
            </div>

            <div className="mt-8 flex flex-1 flex-col justify-between gap-8">
              <div className="space-y-8">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-2xl">
                    <div className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700/80 dark:text-sky-200/80">
                      {replaceBrandNameText(ta("accessTitle"), brandName)}
                    </div>
                    <h1 className="mt-3 text-5xl font-semibold tracking-[-0.06em] text-slate-950 dark:text-white sm:text-6xl lg:text-7xl">
                      {brandName}
                    </h1>
                    <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
                      {replaceBrandNameText(ta("entryHeroDescription"), brandName)}
                    </p>
                  </div>

                  <div className="hidden shrink-0 lg:block">
                    <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] border border-white/80 bg-white/78 shadow-[0_18px_45px_rgba(15,23,42,0.12)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/65">
                      <BrandMark alt={`${brandName} brand mark`} className="h-16 w-16" />
                    </div>
                  </div>
                </div>

                <div className="rounded-[2rem] border border-white/75 bg-white/72 p-5 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/50">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    {ta("entryPanelLabel")}
                  </div>
                  <div className="mt-3 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white sm:text-2xl">
                    {ta("entryPanelTitle")}
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {ta("entryPanelDescription")}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {workspaceSignals.map((signal) => {
                    const Icon = signal.icon
                    return (
                      <div
                        key={signal.label}
                        className={`rounded-[1.6rem] border p-4 shadow-sm backdrop-blur ${signal.tone}`}
                      >
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
                          <Icon size={14} />
                          {signal.label}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {workspaceFeatures.map((feature) => {
                  const Icon = feature.icon

                  return (
                    <div
                      key={feature.title}
                      className="rounded-[1.7rem] border border-white/70 bg-white/76 p-4 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/55"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          <Icon size={20} />
                        </div>
                        <div className="text-sm font-semibold text-slate-950 dark:text-white">
                          {feature.title}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          <section className="tm-glass-panel-strong flex h-full flex-col overflow-hidden rounded-[2.4rem] p-5 sm:p-6 lg:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="tm-section-label">{needsSetup ? ta("headline") : ta("workspaceEntry")}</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                  {authTitle}
                </div>
              </div>
              <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200 sm:flex">
                {needsSetup ? <KeyRound size={20} /> : isRegisterMode ? <UserPlus size={20} /> : <Mail size={20} />}
              </div>
            </div>

            {!canUseSensitiveAdminActions && (
              <div className="mt-5 flex items-start gap-3 rounded-[1.4rem] border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">{ta("insecureContextTitle")}</div>
                  <p className="mt-1 leading-6 opacity-90">{ta("insecureContextDescription")}</p>
                </div>
              </div>
            )}

            {isRestoringSession && !isBootstrapping && (
              <div className="mt-5 rounded-[1.4rem] border border-sky-200/80 bg-sky-50/90 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/35 dark:text-sky-100">
                {ta("loadingStatus")}
              </div>
            )}

            <div className="mt-6 flex flex-1 flex-col">
              {isBootstrapping ? (
                <div className="flex h-64 flex-1 items-center justify-center text-sm text-slate-400">{ta("loadingStatus")}</div>
              ) : needsSetup ? (
                <div className="space-y-4">
                  <Input
                    label={ta("consoleUsernameLabel")}
                    value={setupUsername}
                    onValueChange={setSetupUsername}
                    variant="bordered"
                    autoComplete="username"
                    classNames={TM_INPUT_CLASSNAMES}
                  />
                  <Input
                    label={ta("setupPasswordLabel")}
                    type="password"
                    value={setupPassword}
                    onValueChange={setSetupPassword}
                    variant="bordered"
                    autoComplete="new-password"
                    classNames={TM_INPUT_CLASSNAMES}
                  />
                  <Input
                    label={ta("confirmPasswordLabel")}
                    type="password"
                    value={setupPasswordConfirm}
                    onValueChange={setSetupPasswordConfirm}
                    variant="bordered"
                    autoComplete="new-password"
                    classNames={TM_INPUT_CLASSNAMES}
                  />
                  <Button
                    color="primary"
                    className="mt-2 h-12 w-full rounded-full bg-sky-600 font-semibold text-white shadow-lg shadow-sky-500/20 transition-all duration-200 hover:bg-sky-700 hover:shadow-sky-500/30 active:scale-[0.98]"
                    onPress={handleSetupAdmin}
                    isLoading={isSubmittingSetup}
                    isDisabled={!canUseSensitiveAdminActions}
                    endContent={!isSubmittingSetup ? <ChevronRight size={16} /> : undefined}
                  >
                    {ta("setupSubmit")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {canRegister && (
                    <div className="rounded-[1.7rem] border border-slate-200/80 bg-slate-50/80 p-1 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/45">
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          className={`rounded-[1.25rem] px-4 py-3 text-sm font-semibold transition-colors ${
                            isRegisterMode
                              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                              : "text-slate-600 hover:bg-white/80 dark:text-slate-300 dark:hover:bg-slate-800/70"
                          }`}
                          onClick={() => {
                            setEntryMode("register")
                            setShowRecovery(false)
                          }}
                        >
                          {ta("registerTab")}
                        </button>
                        <button
                          type="button"
                          className={`rounded-[1.25rem] px-4 py-3 text-sm font-semibold transition-colors ${
                            !isRegisterMode
                              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                              : "text-slate-600 hover:bg-white/80 dark:text-slate-300 dark:hover:bg-slate-800/70"
                          }`}
                          onClick={() => setEntryMode("login")}
                        >
                          {ta("loginTab")}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-[1.7rem] border border-slate-200/80 bg-white/68 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/45">
                    {isRegisterMode ? (
                      <div className="space-y-4">
                        <Input
                          label={ta("registerEmailLabel")}
                          value={registerEmail}
                          onValueChange={setRegisterEmail}
                          variant="bordered"
                          autoComplete="email"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        {inviteCodeRequired && (
                          <Input
                            label={ta("registerInviteCodeLabel")}
                            value={registerInviteCode}
                            onValueChange={setRegisterInviteCode}
                            variant="bordered"
                            autoComplete="one-time-code"
                            classNames={TM_INPUT_CLASSNAMES}
                          />
                        )}
                        {emailOtpEnabled && (
                          <div className="space-y-3">
                            <div className="flex flex-col gap-3 sm:flex-row">
                              <Input
                                label={ta("registerOtpLabel")}
                                value={registerOtpCode}
                                onValueChange={setRegisterOtpCode}
                                variant="bordered"
                                autoComplete="one-time-code"
                                classNames={TM_INPUT_CLASSNAMES}
                              />
                              <Button
                                variant="bordered"
                                className="h-12 rounded-full px-5 sm:mt-7"
                                onPress={handleSendRegisterOtp}
                                isLoading={isSendingRegisterOtp}
                                isDisabled={!canUseSensitiveAdminActions || registerOtpCooldown > 0}
                              >
                                {registerOtpCooldown > 0
                                  ? ta("registerOtpSendCooldown", { seconds: registerOtpCooldown })
                                  : ta("registerOtpSend")}
                              </Button>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{ta("registerOtpHint")}</p>
                          </div>
                        )}
                        <Input
                          label={ta("setupPasswordLabel")}
                          type="password"
                          value={registerPassword}
                          onValueChange={setRegisterPassword}
                          variant="bordered"
                          autoComplete="new-password"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Button
                          variant="flat"
                          className="h-12 w-full rounded-full bg-slate-900 text-white transition-all duration-200 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                          onPress={handleRegisterConsole}
                          isLoading={isSubmittingRegister}
                          isDisabled={!canUseSensitiveAdminActions}
                          endContent={!isSubmittingRegister ? <ChevronRight size={16} /> : undefined}
                        >
                          {ta("registerSubmit")}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Input
                          label={ta("loginIdentityLabel")}
                          value={loginIdentifier}
                          onValueChange={setLoginIdentifier}
                          variant="bordered"
                          autoComplete="username"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Input
                          label={ta("loginPasswordLabel")}
                          type="password"
                          value={loginPassword}
                          onValueChange={setLoginPassword}
                          variant="bordered"
                          autoComplete="current-password"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Button
                          color="primary"
                          className="h-12 w-full rounded-full bg-sky-600 font-semibold text-white shadow-lg shadow-sky-500/20 transition-all duration-200 hover:bg-sky-700 hover:shadow-sky-500/30 active:scale-[0.98]"
                          onPress={handleLoginAdmin}
                          isLoading={isSubmittingLogin}
                          isDisabled={!canUseSensitiveAdminActions}
                          endContent={!isSubmittingLogin ? <ChevronRight size={16} /> : undefined}
                        >
                          {replaceBrandNameText(ta("loginSubmit"), brandName)}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {canUseLinuxDo && (
                      <div className="space-y-1">
                        <Button
                          variant="flat"
                          className="h-10 rounded-full border border-emerald-200 bg-emerald-50 px-4 font-medium text-emerald-700 transition-all duration-200 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200 dark:hover:bg-emerald-950/50"
                          onPress={handleLinuxDoAuth}
                          isLoading={isSubmittingLinuxDo}
                          isDisabled={!canUseSensitiveAdminActions}
                          endContent={!isSubmittingLinuxDo ? <ChevronRight size={16} /> : undefined}
                        >
                          {ta("linuxDoSubmit")}
                        </Button>
                        {inviteCodeRequired && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {ta("linuxDoInviteCodeHint")}
                          </p>
                        )}
                      </div>
                    )}

                    {status?.isRecoveryEnabled && (
                      <button
                        type="button"
                        className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                          showRecovery
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        }`}
                        onClick={() => setShowRecovery((value) => !value)}
                      >
                        {showRecovery ? ta("recoveryToggleHide") : ta("recoveryToggleShow")}
                      </button>
                    )}
                  </div>

                  {status?.isRecoveryEnabled && showRecovery && (
                    <div className="rounded-[1.7rem] border border-slate-200/80 bg-slate-50/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/55">
                      <div className="space-y-4">
                        <Input
                          label={ta("recoveryTokenLabel")}
                          type="password"
                          value={recoveryToken}
                          onValueChange={setRecoveryToken}
                          variant="bordered"
                          autoComplete="one-time-code"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Input
                          label={ta("consoleUsernameLabel")}
                          value={recoveryUsername}
                          onValueChange={setRecoveryUsername}
                          variant="bordered"
                          autoComplete="username"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Input
                          label={ta("recoveryPasswordLabel")}
                          type="password"
                          value={recoveryPassword}
                          onValueChange={setRecoveryPassword}
                          variant="bordered"
                          autoComplete="new-password"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Input
                          label={ta("recoveryConfirmPasswordLabel")}
                          type="password"
                          value={recoveryPasswordConfirm}
                          onValueChange={setRecoveryPasswordConfirm}
                          variant="bordered"
                          autoComplete="new-password"
                          classNames={TM_INPUT_CLASSNAMES}
                        />
                        <Button
                          variant="flat"
                          className="h-11 w-full rounded-full bg-slate-900 text-white transition-all duration-200 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                          onPress={handleRecoverAdmin}
                          isLoading={isSubmittingRecovery}
                          isDisabled={!canUseSensitiveAdminActions}
                          endContent={!isSubmittingRecovery ? <ChevronRight size={16} /> : undefined}
                        >
                          {ta("recoverySubmit")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </motion.div>
      </div>
    </div>
  )
}
