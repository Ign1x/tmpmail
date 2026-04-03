"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@heroui/button"
import { Copy, Check, X, Key, Mail } from "lucide-react"
import { useTranslations } from "next-intl"
import { copyTextToClipboard } from "@/lib/clipboard"

interface AccountInfoBannerProps {
  email: string
  password: string
  onClose: () => void
}

export default function AccountInfoBanner({ email, password, onClose }: AccountInfoBannerProps) {
  const [copiedEmail, setCopiedEmail] = useState(false)
  const [copiedPassword, setCopiedPassword] = useState(false)
  const emailResetTimeoutRef = useRef<number | null>(null)
  const passwordResetTimeoutRef = useRef<number | null>(null)
  const t = useTranslations("accountBanner")

  useEffect(() => {
    return () => {
      if (emailResetTimeoutRef.current) {
        window.clearTimeout(emailResetTimeoutRef.current)
      }
      if (passwordResetTimeoutRef.current) {
        window.clearTimeout(passwordResetTimeoutRef.current)
      }
    }
  }, [])

  const handleCopyEmail = async () => {
    try {
      await copyTextToClipboard(email)
      setCopiedEmail(true)
      if (emailResetTimeoutRef.current) {
        window.clearTimeout(emailResetTimeoutRef.current)
      }
      emailResetTimeoutRef.current = window.setTimeout(() => setCopiedEmail(false), 2000)
    } catch (err) {
      console.error("Failed to copy email:", err)
    }
  }

  const handleCopyPassword = async () => {
    try {
      await copyTextToClipboard(password)
      setCopiedPassword(true)
      if (passwordResetTimeoutRef.current) {
        window.clearTimeout(passwordResetTimeoutRef.current)
      }
      passwordResetTimeoutRef.current = window.setTimeout(() => setCopiedPassword(false), 2000)
    } catch (err) {
      console.error("Failed to copy password:", err)
    }
  }

  return (
    <div className="border-b border-emerald-200/80 bg-gradient-to-r from-emerald-50/90 via-white/90 to-sky-50/85 px-4 py-3 backdrop-blur dark:border-emerald-900/50 dark:from-emerald-950/30 dark:via-slate-950/85 dark:to-sky-950/20">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200">
              <Check size={16} />
            </div>
            <span className="hidden text-sm font-semibold sm:inline">{t("created")}</span>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-emerald-200 bg-white/82 px-3 py-2 shadow-sm backdrop-blur dark:border-emerald-900/60 dark:bg-slate-900/82">
              <Mail size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="max-w-[16rem] truncate font-mono text-sm text-slate-800 dark:text-slate-200 sm:max-w-none">{email}</span>
              <Button isIconOnly size="sm" variant="light" className="h-7 w-7 min-w-7 rounded-full" onPress={handleCopyEmail}>
                {copiedEmail ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} className="text-slate-500" />}
              </Button>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-sky-200 bg-white/82 px-3 py-2 shadow-sm backdrop-blur dark:border-sky-900/60 dark:bg-slate-900/82">
              <Key size={14} className="shrink-0 text-sky-600 dark:text-sky-400" />
              <span className="hidden text-xs text-slate-500 dark:text-slate-400 sm:inline">{t("password")}:</span>
              <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{password}</span>
              <Button isIconOnly size="sm" variant="light" className="h-7 w-7 min-w-7 rounded-full" onPress={handleCopyPassword}>
                {copiedPassword ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} className="text-slate-500" />}
              </Button>
            </div>
          </div>
        </div>

        <span className="hidden shrink-0 text-xs text-emerald-700 dark:text-emerald-300 md:inline">{t("saveWarning")}</span>

        <Button
          isIconOnly
          size="sm"
          variant="light"
          className="h-8 w-8 min-w-8 shrink-0 rounded-full text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          onPress={onClose}
        >
          <X size={16} />
        </Button>
      </div>
    </div>
  )
}
