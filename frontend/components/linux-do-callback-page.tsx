"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@heroui/button"
import { Spinner } from "@heroui/spinner"
import { AlertCircle, ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"

import { TM_INPUT_CLASSNAMES } from "@/components/heroui-field-styles"
import { Input } from "@/components/tm-form-fields"
import { useBranding } from "@/contexts/branding-context"
import { setStoredAdminSession, storePendingAdminSession } from "@/lib/admin-session"
import { completeLinuxDoLogin, type AdminSessionInfo } from "@/lib/api"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"
import { replaceBrandNameText } from "@/lib/site-branding"

const LINUX_DO_STATE_STORAGE_KEY = "tmpmail-linux-do-oauth-state"
const LINUX_DO_INVITE_CODE_STORAGE_KEY = "tmpmail-linux-do-invite-code"
const LINUX_DO_PENDING_TOKEN_STORAGE_KEY = "tmpmail-linux-do-pending-token"
const LINUX_DO_REDIRECT_URI_STORAGE_KEY = "tmpmail-linux-do-redirect-uri"
const LINUX_DO_RETURN_PATH_STORAGE_KEY = "tmpmail-linux-do-return-path"

interface LinuxDoCallbackPageProps {
  callbackPath: string
  code?: string
  error?: string
  homePath: string
  state?: string
}

function getLinuxDoErrorDescription(error: string, fallback: string): string {
  switch (error) {
    case "access_denied":
      return fallback
    default:
      return error.trim() || fallback
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

function resolveLinuxDoReturnPath(fallback: string): string {
  if (typeof window === "undefined") {
    return fallback
  }

  const value = sessionStorage.getItem(LINUX_DO_RETURN_PATH_STORAGE_KEY)?.trim() || ""
  if (!value || !value.startsWith("/") || value.startsWith("//") || /\s/.test(value)) {
    return fallback
  }

  return value
}

function resolveLinuxDoRedirectUri(callbackPath: string): string {
  if (typeof window === "undefined") {
    return callbackPath
  }

  const stored = sessionStorage.getItem(LINUX_DO_REDIRECT_URI_STORAGE_KEY)?.trim() || ""
  if (stored) {
    try {
      return new URL(stored).toString()
    } catch {}
  }

  return new URL(callbackPath, window.location.origin).toString()
}

export default function LinuxDoCallbackPage({
  callbackPath,
  code,
  error,
  homePath,
  state,
}: LinuxDoCallbackPageProps) {
  const t = useTranslations("admin")
  const { brandName } = useBranding()
  const [fatalFailure, setFatalFailure] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState("")
  const [invitePromptMessage, setInvitePromptMessage] = useState<string | null>(null)
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [isSubmittingInviteCode, setIsSubmittingInviteCode] = useState(false)
  const hasStartedRef = useRef(false)

  const clearLinuxDoSessionStorage = useCallback(() => {
    if (typeof window === "undefined") {
      return
    }

    sessionStorage.removeItem(LINUX_DO_STATE_STORAGE_KEY)
    sessionStorage.removeItem(LINUX_DO_INVITE_CODE_STORAGE_KEY)
    sessionStorage.removeItem(LINUX_DO_PENDING_TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(LINUX_DO_REDIRECT_URI_STORAGE_KEY)
    sessionStorage.removeItem(LINUX_DO_RETURN_PATH_STORAGE_KEY)
  }, [])

  const translateInviteMessage = useCallback((message?: string | null): string => {
    switch ((message || "").trim()) {
      case "invite code is invalid":
        return t("linuxDoInviteCodeInvalid")
      case "invite code is disabled":
        return t("linuxDoInviteCodeDisabled")
      case "invite code has been exhausted":
        return t("linuxDoInviteCodeExhausted")
      case "invite code is required":
      case "":
        return t("linuxDoInviteRequiredDescription")
      default:
        return message?.trim() || t("linuxDoInviteRequiredDescription")
    }
  }, [t])

  const handleInviteCodeChange = (value: string) => {
    setInviteCode(value)
    setInvitePromptMessage(null)

    if (typeof window === "undefined") {
      return
    }

    if (value.trim()) {
      sessionStorage.setItem(LINUX_DO_INVITE_CODE_STORAGE_KEY, value.trim())
      return
    }

    sessionStorage.removeItem(LINUX_DO_INVITE_CODE_STORAGE_KEY)
  }

  const redirectToHome = useCallback(() => {
    clearLinuxDoSessionStorage()
    window.location.replace(homePath)
  }, [clearLinuxDoSessionStorage, homePath])

  const finishAuthenticated = useCallback((session: AdminSessionInfo) => {
    const returnPath = resolveLinuxDoReturnPath(homePath)
    storePendingAdminSession(session)
    setStoredAdminSession()
    clearLinuxDoSessionStorage()
    window.location.replace(returnPath)
  }, [clearLinuxDoSessionStorage, homePath])

  const submitCompletion = useCallback(async (payload: {
    code?: string
    inviteCode?: string
    pendingToken?: string
  }) => {
    if (typeof window === "undefined") {
      return
    }

    const redirectUri = resolveLinuxDoRedirectUri(callbackPath)
    const response = await completeLinuxDoLogin(
      {
        code: payload.code,
        redirectUri,
        inviteCode: payload.inviteCode,
        pendingToken: payload.pendingToken,
      },
      DEFAULT_PROVIDER_ID,
    )

    if (response.status === "authenticated") {
      finishAuthenticated(response.session)
      return
    }

    const nextPendingToken = response.pendingToken.trim()
    if (payload.inviteCode?.trim()) {
      sessionStorage.setItem(LINUX_DO_INVITE_CODE_STORAGE_KEY, payload.inviteCode.trim())
    }
    sessionStorage.setItem(LINUX_DO_PENDING_TOKEN_STORAGE_KEY, nextPendingToken)
    if (!payload.pendingToken && !payload.inviteCode?.trim()) {
      window.location.replace(callbackPath)
      return
    }
    setPendingToken(nextPendingToken)
    setInvitePromptMessage(translateInviteMessage(response.message))
  }, [callbackPath, finishAuthenticated, translateInviteMessage])

  useEffect(() => {
    if (hasStartedRef.current) {
      return
    }
    hasStartedRef.current = true

    const completeAuth = async () => {
      if (typeof window === "undefined") {
        return
      }

      const storedState = sessionStorage.getItem(LINUX_DO_STATE_STORAGE_KEY)?.trim() || ""
      const storedInviteCode =
        sessionStorage.getItem(LINUX_DO_INVITE_CODE_STORAGE_KEY)?.trim() || ""
      const storedPendingToken =
        sessionStorage.getItem(LINUX_DO_PENDING_TOKEN_STORAGE_KEY)?.trim() || ""
      setInviteCode(storedInviteCode)

      if (error) {
        throw new Error(getLinuxDoErrorDescription(error, t("linuxDoAccessDenied")))
      }

      if (storedPendingToken) {
        setPendingToken(storedPendingToken)
        setInvitePromptMessage(t("linuxDoInviteRequiredDescription"))
        sessionStorage.removeItem(LINUX_DO_STATE_STORAGE_KEY)
        return
      }

      if (!code?.trim()) {
        throw new Error(t("linuxDoCodeMissing"))
      }

      if (!state?.trim() || !storedState || storedState !== state) {
        throw new Error(t("linuxDoStateMismatch"))
      }

      sessionStorage.removeItem(LINUX_DO_INVITE_CODE_STORAGE_KEY)
      sessionStorage.removeItem(LINUX_DO_STATE_STORAGE_KEY)
      await submitCompletion({
        code,
        inviteCode: storedInviteCode || undefined,
      })
    }

    void completeAuth().catch((caughtError: unknown) => {
      setFatalFailure(
        getErrorMessage(
          caughtError,
          replaceBrandNameText(t("linuxDoCallbackFailedDescription"), brandName),
        ),
      )
    })
  }, [brandName, code, error, state, submitCompletion, t])

  const handleInviteCodeSubmit = async () => {
    if (!pendingToken) {
      return
    }

    const normalizedInviteCode = inviteCode.trim()
    if (!normalizedInviteCode) {
      setInvitePromptMessage(t("registerInviteCodeRequired"))
      return
    }

    setIsSubmittingInviteCode(true)
    try {
      await submitCompletion({
        inviteCode: normalizedInviteCode,
        pendingToken,
      })
    } catch (caughtError: unknown) {
      setFatalFailure(
        getErrorMessage(
          caughtError,
          replaceBrandNameText(t("linuxDoCallbackFailedDescription"), brandName),
        ),
      )
    } finally {
      setIsSubmittingInviteCode(false)
    }
  }

  return (
    <div className="tm-page-backdrop relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 text-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.12),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.42),transparent_30%)]" />

      <div className="tm-glass-panel-strong relative w-full max-w-md rounded-[1.8rem] p-6 sm:p-7">
        <div className="tm-section-label">{t("linuxDoSubmit")}</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{brandName}</h1>

        {fatalFailure ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-[1.4rem] border border-rose-200 bg-rose-50/90 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-200">
                  <AlertCircle size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                    {t("linuxDoCallbackFailed")}
                  </p>
                  <p className="mt-1 text-sm leading-7 text-rose-700 dark:text-rose-200">
                    {fatalFailure}
                  </p>
                </div>
              </div>
            </div>

            <Button
              color="primary"
              className="h-11 w-full rounded-full bg-sky-600 font-semibold text-white shadow-lg shadow-sky-500/20 transition-all duration-200 hover:bg-sky-700 hover:shadow-sky-500/30 active:scale-[0.98]"
              onPress={redirectToHome}
              endContent={<ChevronRight size={16} />}
            >
              {replaceBrandNameText(t("backToTmpMail"), brandName)}
            </Button>
          </div>
        ) : pendingToken ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-[1.4rem] border border-amber-200 bg-amber-50/90 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200">
                  <AlertCircle size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    {t("linuxDoInviteRequiredTitle")}
                  </p>
                  <p className="mt-1 text-sm leading-7 text-amber-700 dark:text-amber-200">
                    {invitePromptMessage || t("linuxDoInviteRequiredDescription")}
                  </p>
                </div>
              </div>
            </div>

            <Input
              label={t("registerInviteCodeLabel")}
              value={inviteCode}
              onValueChange={handleInviteCodeChange}
              variant="bordered"
              autoComplete="one-time-code"
              classNames={TM_INPUT_CLASSNAMES}
            />

            <Button
              color="primary"
              className="h-11 w-full rounded-full bg-sky-600 font-semibold text-white shadow-lg shadow-sky-500/20 transition-all duration-200 hover:bg-sky-700 hover:shadow-sky-500/30 active:scale-[0.98]"
              onPress={() => void handleInviteCodeSubmit()}
              isLoading={isSubmittingInviteCode}
              endContent={!isSubmittingInviteCode ? <ChevronRight size={16} /> : undefined}
            >
              {t("linuxDoInviteRequiredSubmit")}
            </Button>

            <Button
              variant="bordered"
              className="h-11 w-full rounded-full"
              onPress={redirectToHome}
              isDisabled={isSubmittingInviteCode}
            >
              {replaceBrandNameText(t("backToTmpMail"), brandName)}
            </Button>
          </div>
        ) : (
          <div className="mt-5 rounded-[1.4rem] border border-slate-200/80 bg-white/72 p-5 dark:border-slate-800/80 dark:bg-slate-950/55">
            <div className="flex items-center gap-3">
              <Spinner size="sm" color="primary" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("linuxDoCallbackLoading")}
                </p>
                <p className="mt-1 text-sm leading-7 text-slate-500 dark:text-slate-400">
                  {t("linuxDoCallbackDescription")}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
