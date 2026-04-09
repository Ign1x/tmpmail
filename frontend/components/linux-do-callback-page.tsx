"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@heroui/button"
import { Spinner } from "@heroui/spinner"
import { AlertCircle, ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"

import { setStoredAdminSession } from "@/lib/admin-session"
import { completeLinuxDoLogin } from "@/lib/api"
import { BRAND_NAME, DEFAULT_PROVIDER_ID } from "@/lib/provider-config"

const LINUX_DO_STATE_STORAGE_KEY = "tmpmail-linux-do-oauth-state"
const LINUX_DO_INVITE_CODE_STORAGE_KEY = "tmpmail-linux-do-invite-code"

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

export default function LinuxDoCallbackPage({
  callbackPath,
  code,
  error,
  homePath,
  state,
}: LinuxDoCallbackPageProps) {
  const t = useTranslations("admin")
  const [failure, setFailure] = useState<string | null>(null)
  const hasStartedRef = useRef(false)

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
      sessionStorage.removeItem(LINUX_DO_STATE_STORAGE_KEY)

      if (error) {
        throw new Error(getLinuxDoErrorDescription(error, t("linuxDoAccessDenied")))
      }

      if (!code?.trim()) {
        throw new Error(t("linuxDoCodeMissing"))
      }

      if (!state?.trim() || !storedState || storedState !== state) {
        throw new Error(t("linuxDoStateMismatch"))
      }

      const redirectUri = new URL(callbackPath, window.location.origin).toString()
      await completeLinuxDoLogin(
        {
          code,
          redirectUri,
          inviteCode: storedInviteCode || undefined,
        },
        DEFAULT_PROVIDER_ID,
      )

      setStoredAdminSession()
      sessionStorage.removeItem(LINUX_DO_INVITE_CODE_STORAGE_KEY)
      window.location.replace(homePath)
    }

    void completeAuth().catch((caughtError: unknown) => {
      if (caughtError instanceof Error && caughtError.message.trim()) {
        setFailure(caughtError.message)
        return
      }

      setFailure(t("linuxDoCallbackFailedDescription"))
    })
  }, [callbackPath, code, error, homePath, state, t])

  return (
    <div className="tm-page-backdrop relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 text-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.12),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.42),transparent_30%)]" />

      <div className="tm-glass-panel-strong relative w-full max-w-md rounded-[1.8rem] p-6 sm:p-7">
        <div className="tm-section-label">{t("linuxDoSubmit")}</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{BRAND_NAME}</h1>

        {failure ? (
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
                  <p className="mt-1 text-sm leading-7 text-rose-700 dark:text-rose-200">{failure}</p>
                </div>
              </div>
            </div>

            <Button
              color="primary"
              className="h-11 w-full rounded-full bg-sky-600 font-semibold text-white shadow-lg shadow-sky-500/20 transition-all duration-200 hover:bg-sky-700 hover:shadow-sky-500/30 active:scale-[0.98]"
              onPress={() => window.location.replace(homePath)}
              endContent={<ChevronRight size={16} />}
            >
              {t("backToTmpMail")}
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
