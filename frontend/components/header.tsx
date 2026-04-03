"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Avatar } from "@heroui/avatar"
import { Button } from "@heroui/button"
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from "@heroui/dropdown"
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  LogOut,
  Trash2,
  User,
  UserPlus,
  Wifi,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import ThemeModeToggle from "@/components/theme-mode-toggle"
import { useAuth } from "@/contexts/auth-context"
import { useMailStatus } from "@/contexts/mail-status-context"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import { useHydrated } from "@/hooks/use-hydrated"
import { copyTextToClipboard } from "@/lib/clipboard"
import {
  DEFAULT_PROVIDER_ID,
  getProviderAccentClass,
  getProviderName,
} from "@/lib/provider-config"

interface HeaderProps {
  onCreateAccount: () => void
  onLocaleChange: () => void
  onLogin?: () => void
  isMobile?: boolean
}

function getInitials(email: string) {
  return email ? email.substring(0, 2).toUpperCase() : "NA"
}

function getRandomColor(email: string) {
  if (!email) return "default"
  const colors = ["primary", "secondary", "success", "warning", "danger"]
  const hash = email.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

function HeaderSkeleton({ isMobile }: { isMobile: boolean }) {
  return (
    <header
      className={`sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/78 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/74 ${
        isMobile ? "px-4" : "px-6"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="h-10 w-full max-w-[16rem] animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
        <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
        <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
        {!isMobile && <div className="h-10 w-28 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800/80" />}
      </div>
    </header>
  )
}

function ActionIconButton({
  ariaLabel,
  children,
  onPress,
}: {
  ariaLabel: string
  children: React.ReactNode
  onPress?: () => void
}) {
  return (
    <Button
      isIconOnly
      variant="light"
      size="sm"
      onPress={onPress}
      aria-label={ariaLabel}
      className="tm-icon-button h-10 w-10 min-w-10"
    >
      {children}
    </Button>
  )
}

export default function Header({
  onCreateAccount,
  onLocaleChange,
  onLogin,
  isMobile = false,
}: HeaderProps) {
  const { isAuthenticated, currentAccount, accounts, logout, switchAccount, deleteAccount } = useAuth()
  const { isEnabled, setIsEnabled } = useMailStatus()
  const hydrated = useHydrated()
  const { toast } = useHeroUIToast()
  const t = useTranslations("header")
  const tc = useTranslations("common")
  const tm = useTranslations("messageList")
  const locale = useLocale()
  const [copiedEmail, setCopiedEmail] = useState(false)
  const [copiedPassword, setCopiedPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const emailResetTimeoutRef = useRef<number | null>(null)
  const passwordResetTimeoutRef = useRef<number | null>(null)

  const currentProviderName = currentAccount
    ? getProviderName(currentAccount.providerId || DEFAULT_PROVIDER_ID)
    : getProviderName(DEFAULT_PROVIDER_ID)

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

  const handleCopyToClipboard = useCallback(
    async (text: string, type: "email" | "content" = "content") => {
      try {
        await copyTextToClipboard(text)
        if (type === "email") {
          setCopiedEmail(true)
          if (emailResetTimeoutRef.current) {
            window.clearTimeout(emailResetTimeoutRef.current)
          }
          emailResetTimeoutRef.current = window.setTimeout(() => setCopiedEmail(false), 2000)
        }

        toast({
          title: type === "email" ? tc("emailCopied") : tc("contentCopied"),
          description: text,
          color: "success",
          variant: "flat",
        })
      } catch (error) {
        console.error("Failed to copy:", error)
        toast({
          title: tc("copyFailed"),
          description: tc("clipboardError"),
          color: "danger",
          variant: "flat",
        })
      }
    },
    [tc, toast],
  )

  const handleCopyPassword = useCallback(
    async (password: string) => {
      try {
        await copyTextToClipboard(password)
        setCopiedPassword(true)
        toast({ title: t("passwordCopied"), color: "success", variant: "flat" })
        if (passwordResetTimeoutRef.current) {
          window.clearTimeout(passwordResetTimeoutRef.current)
        }
        passwordResetTimeoutRef.current = window.setTimeout(() => setCopiedPassword(false), 2000)
      } catch (error) {
        console.error("Failed to copy password:", error)
        toast({
          title: tc("copyFailed"),
          description: tc("clipboardError"),
          color: "danger",
          variant: "flat",
        })
      }
    },
    [t, tc, toast],
  )

  const toggleMailChecker = () => {
    const nextState = !isEnabled
    setIsEnabled(nextState)
    toast({
      title: nextState ? t("mailCheckEnabled") : t("mailCheckDisabled"),
      description: nextState ? t("mailCheckEnabledDesc") : t("mailCheckDisabledDesc"),
      color: nextState ? "success" : "warning",
      variant: "flat",
      icon: <Wifi size={16} />,
    })
  }

  if (!hydrated) {
    return <HeaderSkeleton isMobile={isMobile} />
  }

  const accountCountLabel = `${accounts.length}`
  const providerAccent = getProviderAccentClass(currentAccount?.providerId || DEFAULT_PROVIDER_ID, "soft")
  const accountStatusLabel = isAuthenticated && currentAccount ? tm("streamConnected") : currentProviderName

  return (
    <header
      className={`sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/78 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/74 ${
        isMobile ? "px-4" : "px-6"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {isAuthenticated && currentAccount ? (
          <div className="tm-glass-subtle flex max-w-full min-w-0 items-center gap-3 rounded-full px-2.5 py-2">
            <Avatar
              name={getInitials(currentAccount.address)}
              color={getRandomColor(currentAccount.address) as never}
              size="sm"
              className="shrink-0"
            />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {currentAccount.address}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {accountCountLabel}
                </span>
              </div>
              {!isMobile && (
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className={`h-2 w-2 rounded-full ${providerAccent}`} />
                  {currentProviderName}
                </div>
              )}
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    onPress={() => void handleCopyToClipboard(currentAccount.address, "email")}
                    className="h-8 w-8 min-w-8 rounded-full text-slate-500 dark:text-slate-300"
                  >
                    {copiedEmail ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{copiedEmail ? tc("copied") : tc("copyEmailTooltip")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : (
          !isMobile && (
            <div className="tm-glass-subtle flex items-center gap-3 rounded-full px-4 py-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
                <User size={16} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{currentProviderName}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{accountStatusLabel}</div>
              </div>
            </div>
          )
        )}
      </div>

      <div className={`flex items-center ${isMobile ? "gap-2" : "gap-2.5"}`}>
        {!isAuthenticated && !isMobile && (
          <>
            <Button
              variant="flat"
              size="sm"
              onPress={onLogin || (() => {})}
              className="rounded-full border border-slate-200/80 bg-white/82 px-4 text-slate-700 shadow-sm backdrop-blur active:scale-[0.98] dark:border-slate-700/80 dark:bg-slate-900/82 dark:text-slate-200"
              startContent={<User size={15} />}
            >
              {t("loginExisting")}
            </Button>
            <Button
              color="primary"
              size="sm"
              onPress={onCreateAccount}
              className="rounded-full bg-sky-600 px-4 font-semibold text-white shadow-lg shadow-sky-500/20 hover:bg-sky-700"
              startContent={<UserPlus size={15} />}
            >
              {t("createNew")}
            </Button>
          </>
        )}

        {isAuthenticated && currentAccount && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <ActionIconButton
                    ariaLabel={isEnabled ? t("disableMailCheck") : t("enableMailCheck")}
                    onPress={toggleMailChecker}
                  >
                    <Wifi size={16} className={isEnabled ? "text-emerald-500" : "text-slate-400"} />
                  </ActionIconButton>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{isEnabled ? t("mailAutoCheckOn") : t("mailAutoCheckOff")}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isEnabled ? t("mailAutoCheckOnDesc") : t("mailAutoCheckOffDesc")}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <ThemeModeToggle buttonClassName="tm-icon-button h-10 w-10 min-w-10 text-slate-600 dark:text-slate-300" />

        <ActionIconButton
          ariaLabel={locale === "en" ? t("switchToChinese") : t("switchToEnglish")}
          onPress={onLocaleChange}
        >
          <Languages size={18} />
        </ActionIconButton>

        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Button
              isIconOnly
              variant="light"
              size="sm"
              className="tm-icon-button h-10 w-10 min-w-10 overflow-hidden"
            >
              {isAuthenticated && currentAccount ? (
                <Avatar
                  name={getInitials(currentAccount.address)}
                  color={getRandomColor(currentAccount.address) as never}
                  size="sm"
                />
              ) : (
                <User size={18} />
              )}
            </Button>
          </DropdownTrigger>
          <DropdownMenu aria-label="User actions" className="max-h-[70vh] min-w-[18rem] overflow-y-auto p-1">
            {[
              ...(isAuthenticated && currentAccount
                ? [
                    <DropdownSection key="current-account" title={t("currentAccount")} showDivider>
                      <DropdownItem
                        key="current-email"
                        textValue={currentAccount.address}
                        onPress={() => void handleCopyToClipboard(currentAccount.address, "email")}
                        endContent={
                          copiedEmail ? (
                            <Check size={16} className="text-emerald-500" />
                          ) : (
                            <Copy size={16} className="text-slate-400 dark:text-slate-300" />
                          )
                        }
                        className="rounded-2xl py-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-800 dark:text-white">
                            {currentAccount.address}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{currentProviderName}</div>
                        </div>
                      </DropdownItem>

                      {currentAccount.password ? (
                        <DropdownItem key="current-password" textValue="password" isReadOnly className="rounded-2xl py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <KeyRound size={14} className="shrink-0 text-slate-400" />
                              <span className="truncate text-xs font-mono text-slate-500 dark:text-slate-400">
                                {showPassword ? currentAccount.password : "••••••••••••"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setShowPassword((value) => !value)
                                }}
                                className="rounded-full p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                {showPassword ? (
                                  <EyeOff size={14} className="text-slate-400" />
                                ) : (
                                  <Eye size={14} className="text-slate-400" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleCopyPassword(currentAccount.password!)
                                }}
                                className="rounded-full p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                {copiedPassword ? (
                                  <Check size={14} className="text-emerald-500" />
                                ) : (
                                  <Copy size={14} className="text-slate-400" />
                                )}
                              </button>
                            </div>
                          </div>
                        </DropdownItem>
                      ) : (
                        <DropdownItem key="current-password-empty" textValue="password-hidden" className="hidden" isReadOnly />
                      )}
                    </DropdownSection>,
                  ]
                : []),
              ...(isAuthenticated && accounts.length > 1
                ? [
                    <DropdownSection key="switch-accounts" title={t("switchAccount")} showDivider>
                      {accounts
                        .filter((account) => account.address !== currentAccount?.address)
                        .map((account) => (
                          <DropdownItem
                            key={account.id}
                            textValue={account.address}
                            className="rounded-2xl py-2"
                            startContent={
                              <Avatar
                                name={getInitials(account.address)}
                                color={getRandomColor(account.address) as never}
                                size="sm"
                              />
                            }
                            onPress={async () => {
                              try {
                                await switchAccount(account)
                              } catch {
                                toast({
                                  title: t("accountSwitchFailed"),
                                  description: t("accountSwitchFailedDesc"),
                                  color: "danger",
                                  variant: "flat",
                                })
                              }
                            }}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm text-slate-800 dark:text-white">{account.address}</div>
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {getProviderName(account.providerId || DEFAULT_PROVIDER_ID)}
                              </div>
                            </div>
                          </DropdownItem>
                        ))}
                    </DropdownSection>,
                  ]
                : []),
              <DropdownSection key="account-actions" aria-label="Account Actions">
                {isAuthenticated && currentAccount ? (
                  <>
                    <DropdownItem key="login_another" startContent={<User size={16} />} onPress={onLogin || (() => {})} className="rounded-2xl">
                      {t("loginAnother")}
                    </DropdownItem>
                    <DropdownItem key="create_another" startContent={<UserPlus size={16} />} onPress={onCreateAccount} className="rounded-2xl">
                      {t("createNew")}
                    </DropdownItem>
                    <DropdownItem
                      key="delete"
                      color="danger"
                      className="rounded-2xl text-danger"
                      startContent={<Trash2 size={16} />}
                      onPress={() => void deleteAccount(currentAccount.id)}
                    >
                      {t("deleteCurrent")}
                    </DropdownItem>
                  </>
                ) : (
                  <>
                    <DropdownItem key="login" startContent={<User size={16} />} onPress={onLogin || (() => {})} className="rounded-2xl">
                      {t("loginExisting")}
                    </DropdownItem>
                    <DropdownItem key="create" startContent={<UserPlus size={16} />} onPress={onCreateAccount} className="rounded-2xl">
                      {t("createNew")}
                    </DropdownItem>
                  </>
                )}
              </DropdownSection>,
            ]}
          </DropdownMenu>
        </Dropdown>

        {isAuthenticated && (
          <ActionIconButton ariaLabel={t("logout")} onPress={logout}>
            <LogOut size={18} />
          </ActionIconButton>
        )}
      </div>
    </header>
  )
}
