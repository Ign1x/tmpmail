"use client"

import { useEffect, useEffectEvent, useState } from "react"
import { Button } from "@heroui/button"
import { Card, CardBody } from "@heroui/card"
import { Input } from "@heroui/input"
import { ArrowLeft, CheckCircle2, ShieldAlert, ShieldCheck, UserRound, Users2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter } from "@/i18n/navigation"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import {
  getAdminStatus,
  loginAdmin,
  recoverAdmin,
  setupAdminPassword,
  validateAdminSession,
  type AdminStatus,
} from "@/lib/api"
import {
  clearStoredAdminSession,
  getStoredAdminSession,
  setStoredAdminSession,
  storeRevealedAdminKey,
} from "@/lib/admin-session"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"
import ThemeModeToggle from "@/components/theme-mode-toggle"

const ADMIN_KEY_VISIBLE_MS = 60_000

interface AdminEntryPageProps {
  entryPath: string
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

export default function AdminEntryPage({
  entryPath,
  consolePath,
  requireSecureTransport,
}: AdminEntryPageProps) {
  const router = useRouter()
  const { toast } = useHeroUIToast()
  const ta = useTranslations("admin")
  const tc = useTranslations("common")

  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [setupUsername, setSetupUsername] = useState("admin")
  const [setupPassword, setSetupPassword] = useState("")
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState("")
  const [loginUsername, setLoginUsername] = useState("admin")
  const [loginPassword, setLoginPassword] = useState("")
  const [recoveryToken, setRecoveryToken] = useState("")
  const [recoveryUsername, setRecoveryUsername] = useState("admin")
  const [recoveryPassword, setRecoveryPassword] = useState("")
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState("")
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false)
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false)
  const [isSubmittingRecovery, setIsSubmittingRecovery] = useState(false)
  const [isSecureAdminContext, setIsSecureAdminContext] = useState(() => !requireSecureTransport)
  const [showRecovery, setShowRecovery] = useState(false)

  const needsSetup = status?.isBootstrapRequired ?? true
  const canUseSensitiveAdminActions = !requireSecureTransport || isSecureAdminContext
  const statusCards = [
    {
      label: ta("statusSetupLabel"),
      value: needsSetup ? ta("statusSetupPending") : ta("statusSetupReady"),
      tone: needsSetup ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300",
      icon: needsSetup ? <ShieldAlert size={14} /> : <CheckCircle2 size={14} />,
    },
    {
      label: ta("menuUsers"),
      value: String(status?.usersTotal ?? 0),
      tone: "text-slate-700 dark:text-slate-200",
      icon: <Users2 size={14} />,
    },
    {
      label: ta("statusAdminsLabel"),
      value: String(status?.adminUsersTotal ?? 0),
      tone: "text-slate-700 dark:text-slate-200",
      icon: <ShieldCheck size={14} />,
    },
    {
      label: ta("systemEnabledLabel"),
      value: status?.systemEnabled ? ta("systemEnabledOn") : ta("systemEnabledOff"),
      tone: status?.systemEnabled ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
      icon: <CheckCircle2 size={14} />,
    },
  ]

  const redirectToConsole = useEffectEvent(() => {
    router.replace(consolePath)
  })

  useEffect(() => {
    setIsSecureAdminContext(!requireSecureTransport || isTrustedAdminContext())
  }, [requireSecureTransport])

  useEffect(() => {
    if (!status?.isRecoveryEnabled) {
      setShowRecovery(false)
    }
  }, [status?.isRecoveryEnabled])

  useEffect(() => {
    const bootstrap = async () => {
      setIsBootstrapping(true)

      try {
        const nextStatus = await getAdminStatus(DEFAULT_PROVIDER_ID)
        setStatus(nextStatus)
        const storedSession = getStoredAdminSession()

        if (storedSession && (!requireSecureTransport || isTrustedAdminContext())) {
          try {
            const hasValidSession = await validateAdminSession(storedSession, DEFAULT_PROVIDER_ID)
            if (hasValidSession) {
              redirectToConsole()
              return
            }

            clearStoredAdminSession()
          } catch {
            clearStoredAdminSession()
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
  }, [requireSecureTransport])

  const enterConsole = (sessionToken: string, apiKey?: string) => {
    setStoredAdminSession(sessionToken)
    if (apiKey?.trim()) {
      storeRevealedAdminKey(apiKey, ADMIN_KEY_VISIBLE_MS)
    }
    router.replace(consolePath)
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

    if (setupPassword.trim().length < 6) {
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
      clearStoredAdminSession()
      setSetupPassword("")
      setSetupPasswordConfirm("")
      toast({
        title: ta("setupSuccess"),
        description: ta("setupSuccessDescription"),
        color: "success",
        variant: "flat",
      })
      enterConsole(response.sessionToken, response.apiKey)
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
    if (!canUseSensitiveAdminActions) {
      toast({
        title: ta("secureContextRequired"),
        description: ta("secureContextRequiredDescription"),
        color: "warning",
        variant: "flat",
      })
      return
    }

    if (!loginUsername.trim()) {
      toast({ title: ta("consoleUsernameRequired"), color: "warning", variant: "flat" })
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
          username: loginUsername.trim(),
          password: loginPassword,
        },
        DEFAULT_PROVIDER_ID,
      )
      setLoginPassword("")
      toast({
        title: ta("sessionReady"),
        color: "success",
        variant: "flat",
      })
      enterConsole(response.sessionToken)
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

    if (recoveryPassword.trim().length < 6) {
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
            },
      )
      toast({
        title: ta("recoverySuccess"),
        description: ta("recoverySuccessDescription"),
        color: "success",
        variant: "flat",
      })
      enterConsole(response.sessionToken, response.apiKey)
    } catch (error) {
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-8 text-slate-900 dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100 md:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[84rem] items-center">
        <div className="w-full">
          <Card className="border border-slate-200/80 bg-white/92 shadow-[0_24px_80px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950/70 dark:shadow-none">
            <CardBody className="gap-6 p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    <ShieldCheck size={14} />
                    {ta("accessTitle")}
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                    {needsSetup ? ta("headline") : ta("title")}
                  </h1>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <ThemeModeToggle
                    showLabel
                    variant="flat"
                    buttonClassName="rounded-full bg-white/80 px-4 text-slate-700 shadow-sm backdrop-blur dark:bg-slate-900/70 dark:text-slate-200"
                  />
                  <Button
                    variant="flat"
                    className="rounded-full bg-white/80 px-4 text-slate-700 shadow-sm backdrop-blur dark:bg-slate-900/70 dark:text-slate-200"
                    startContent={<ArrowLeft size={16} />}
                    onPress={() => router.push("/")}
                  >
                    {tc("back")}
                  </Button>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)] xl:items-start">
                <div className="space-y-4">
                  {!canUseSensitiveAdminActions && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
                      {ta("insecureContextTitle")}
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    {statusCards.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-[1.2rem] border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50"
                      >
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          {item.icon}
                          {item.label}
                        </div>
                        <div className={`mt-2 text-sm font-semibold ${item.tone}`}>
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-[1.2rem] border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                    {ta("entryHint", { path: entryPath })}
                  </div>
                </div>

                <div>
                  {isBootstrapping ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                      {ta("loadingStatus")}
                    </div>
                  ) : needsSetup ? (
                    <div className="space-y-4 rounded-[1.6rem] border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-900/45">
                      <Input
                        label={ta("consoleUsernameLabel")}
                        placeholder={ta("consoleUsernamePlaceholder")}
                        value={setupUsername}
                        onValueChange={setSetupUsername}
                        variant="bordered"
                        autoComplete="username"
                      />
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
                        isDisabled={!canUseSensitiveAdminActions}
                      >
                        {ta("setupSubmit")}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4 rounded-[1.6rem] border border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-900/45">
                      <Input
                        label={ta("consoleUsernameLabel")}
                        placeholder={ta("consoleUsernamePlaceholder")}
                        value={loginUsername}
                        onValueChange={setLoginUsername}
                        variant="bordered"
                        autoComplete="username"
                        startContent={<UserRound size={16} className="text-slate-400" />}
                      />
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
                        isDisabled={!canUseSensitiveAdminActions}
                      >
                        {ta("loginSubmit")}
                      </Button>

                      {status?.isRecoveryEnabled && (
                        <div className="border-t border-slate-200 pt-1 dark:border-slate-800">
                          <Button
                            variant="light"
                            className="h-auto px-0 text-sm text-slate-500 dark:text-slate-300"
                            onPress={() => setShowRecovery((currentValue) => !currentValue)}
                          >
                            {showRecovery ? ta("recoveryToggleHide") : ta("recoveryToggleShow")}
                          </Button>

                          {showRecovery && (
                            <div className="mt-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50/70 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
                              <div className="space-y-4">
                                <Input
                                  label={ta("recoveryTokenLabel")}
                                  placeholder={ta("recoveryTokenPlaceholder")}
                                  type="password"
                                  value={recoveryToken}
                                  onValueChange={setRecoveryToken}
                                  variant="bordered"
                                  autoComplete="one-time-code"
                                />
                                <Input
                                  label={ta("consoleUsernameLabel")}
                                  placeholder={ta("consoleUsernamePlaceholder")}
                                  value={recoveryUsername}
                                  onValueChange={setRecoveryUsername}
                                  variant="bordered"
                                  autoComplete="username"
                                />
                                <Input
                                  label={ta("recoveryPasswordLabel")}
                                  placeholder={ta("recoveryPasswordPlaceholder")}
                                  type="password"
                                  value={recoveryPassword}
                                  onValueChange={setRecoveryPassword}
                                  variant="bordered"
                                  autoComplete="new-password"
                                />
                                <Input
                                  label={ta("recoveryConfirmPasswordLabel")}
                                  placeholder={ta("recoveryConfirmPasswordPlaceholder")}
                                  type="password"
                                  value={recoveryPasswordConfirm}
                                  onValueChange={setRecoveryPasswordConfirm}
                                  variant="bordered"
                                  autoComplete="new-password"
                                />
                                <Button
                                  variant="bordered"
                                  className="rounded-xl"
                                  onPress={handleRecoverAdmin}
                                  isLoading={isSubmittingRecovery}
                                  isDisabled={!canUseSensitiveAdminActions}
                                >
                                  {ta("recoverySubmit")}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
