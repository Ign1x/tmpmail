"use client"

import { useEffect, useState } from "react"
import { Button } from "@heroui/button"
import { Card, CardBody } from "@heroui/card"
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal"
import { AlertCircle, CheckCircle, Eye, EyeOff, KeyRound, Mail, Sparkles, User } from "lucide-react"
import { useTranslations } from "next-intl"
import { DomainSelector } from "@/components/domain-selector"
import { TM_INPUT_CLASSNAMES, TM_SELECT_CLASSNAMES } from "@/components/heroui-field-styles"
import { Input, Select, SelectItem } from "@/components/tm-form-fields"
import { useAuth } from "@/contexts/auth-context"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import {
  normalizeDomainName,
  normalizeLocalPart,
  validateLocalPart,
} from "@/lib/account-validation"
import { fetchDomainsFromProvider, getAdminStatus, sendMailboxRegisterOtp } from "@/lib/api"
import { copyTextToClipboard } from "@/lib/clipboard"
import { generateRandomAccountCredentials } from "@/lib/account-credentials"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"

interface AccountModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function AccountModal({ isOpen, onClose }: AccountModalProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [selectedDomain, setSelectedDomain] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [showLoginOption, setShowLoginOption] = useState(false)
  const [expiresIn, setExpiresIn] = useState<string>("0")
  const [otpCode, setOtpCode] = useState("")
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [emailOtpEnabled, setEmailOtpEnabled] = useState(false)
  const [otpCooldown, setOtpCooldown] = useState(0)
  const { register, login } = useAuth()
  const { toast } = useHeroUIToast()
  const t = useTranslations("accountModal")
  const tc = useTranslations("common")
  const th = useTranslations("header")
  const tb = useTranslations("accountBanner")
  const tm = useTranslations("mainPage")
  const normalizedUsername = normalizeLocalPart(username)
  const normalizedDomain = normalizeDomainName(selectedDomain)
  const isAutoGenerateMode = !normalizedUsername && !normalizedDomain && !password.trim()
  const previewAddress =
    normalizedUsername && normalizedDomain
      ? `${normalizedUsername}@${normalizedDomain}`
      : normalizedDomain
        ? `${t("previewRandom")}@${normalizedDomain}`
        : null

  const usernameError = !username
    ? null
    : (() => {
        switch (validateLocalPart(normalizedUsername)) {
          case "tooShort":
            return t("usernameTooShort")
          case "tooLong":
            return t("usernameTooLong")
          case "invalid":
            return t("usernameInvalid")
          default:
            return null
        }
      })()

  const passwordError = !password
    ? null
    : !password.trim()
      ? t("passwordBlank")
      : [...password].length < 10
        ? t("passwordTooShort")
        : null

  const canSubmit =
    isAutoGenerateMode ||
    (Boolean(normalizedUsername && normalizedDomain && password) && !usernameError && !passwordError)
  const otpBlocksAutoGenerate = emailOtpEnabled && isAutoGenerateMode
  const effectiveCanSubmit = canSubmit && !otpBlocksAutoGenerate

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const loadStatus = async () => {
      try {
        const status = await getAdminStatus(DEFAULT_PROVIDER_ID)
        setEmailOtpEnabled(status.emailOtpEnabled)
      } catch {
        setEmailOtpEnabled(false)
      }
    }

    void loadStatus()
  }, [isOpen])

  useEffect(() => {
    if (!emailOtpEnabled) {
      setOtpCode("")
      setOtpCooldown(0)
    }
  }, [emailOtpEnabled])

  useEffect(() => {
    if (otpCooldown <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setOtpCooldown((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [otpCooldown])

  const resetFormState = () => {
    setUsername("")
    setPassword("")
    setSelectedDomain("")
    setExpiresIn("0")
    setOtpCode("")
    setOtpCooldown(0)
    setError(null)
    setShowLoginOption(false)
    setIsPasswordVisible(false)
  }

  const handleClose = () => {
    resetFormState()
    onClose()
  }

  const buildAddressOrThrow = () => {
    if (!normalizedUsername || !normalizedDomain || !password) {
      throw new Error(t("fillAllFields"))
    }

    if (usernameError) {
      throw new Error(usernameError)
    }

    if (passwordError) {
      throw new Error(passwordError)
    }

    return `${normalizedUsername}@${normalizedDomain}`
  }

  const buildOtpTargetAddressOrThrow = () => {
    const email = buildAddressOrThrow()
    if (!emailOtpEnabled) {
      throw new Error(t("otpUnavailable"))
    }
    return email
  }

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      return error.message
    }

    return typeof error === "string" ? error : ""
  }

  const isAddressTakenError = (message: string) =>
    message.includes("该邮箱地址已被使用") ||
    message.includes("Email address already exists") ||
    message.includes("already used") ||
    message.includes("already exists")

  const createRandomAccount = async () => {
    let domain = normalizedDomain

    if (!domain) {
      const domains = await fetchDomainsFromProvider(DEFAULT_PROVIDER_ID)
      domain = normalizeDomainName(domains[0]?.domain || "")
    }

    if (!domain) {
      throw new Error(tm("domainUnavailable"))
    }

    const maxAttempts = 5

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const nextAccount = generateRandomAccountCredentials(domain)

      try {
        await register(nextAccount.email, nextAccount.password, Number(expiresIn))
        return nextAccount
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error)

        if (isAddressTakenError(errorMessage) && attempt < maxAttempts - 1) {
          continue
        }

        throw error
      }
    }

    throw new Error(t("createFailed"))
  }

  const handleSubmit = async () => {
    setIsLoading(true)
    setError(null)
    setShowLoginOption(false)

    try {
      if (isAutoGenerateMode) {
        if (emailOtpEnabled) {
          throw new Error(t("otpAutoGenerateDisabled"))
        }
        const nextAccount = await createRandomAccount()
        let passwordCopied = false

        try {
          await copyTextToClipboard(nextAccount.password)
          passwordCopied = true
        } catch (copyError) {
          console.warn("自动复制随机密码失败:", copyError)
        }

        toast({
          title: tb("created"),
          description: passwordCopied ? th("passwordCopied") : tb("saveWarning"),
          color: "success",
          variant: "flat",
          icon: <CheckCircle size={16} />,
        })
      } else {
        const email = buildAddressOrThrow()
        if (emailOtpEnabled && !otpCode.trim()) {
          throw new Error(t("otpRequired"))
        }
        await register(email, password, Number(expiresIn), emailOtpEnabled ? otpCode.trim() : undefined)
      }

      handleClose()
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error)

      if (isAddressTakenError(errorMessage)) {
        setError(t("emailTaken"))
        setShowLoginOption(true)
      } else if (
        errorMessage.includes("请求过于频繁") ||
        errorMessage.includes("rate limit") ||
        errorMessage.includes("Too many requests")
      ) {
        setError(t("rateLimited"))
        setShowLoginOption(false)
      } else {
        setError(errorMessage || t("createFailed"))
        setShowLoginOption(false)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendOtp = async () => {
    setError(null)

    try {
      const email = buildOtpTargetAddressOrThrow()
      setIsSendingOtp(true)
      const response = await sendMailboxRegisterOtp({ email }, DEFAULT_PROVIDER_ID)
      setOtpCooldown(response.cooldownSeconds)
      toast({
        title: t("otpSent"),
        description: t("otpSentDescription", { seconds: response.expiresInSeconds }),
        color: "success",
        variant: "flat",
      })
    } catch (nextError) {
      const errorMessage = getErrorMessage(nextError)
      setError(errorMessage || t("otpSendFailed"))
    } finally {
      setIsSendingOtp(false)
    }
  }

  const handleTryLogin = async () => {
    setIsLoading(true)
    setError(null)
    setShowLoginOption(false)

    try {
      const email = buildAddressOrThrow()
      await login(email, password)
      handleClose()
    } catch {
      setError(t("loginFailed"))
      setShowLoginOption(false)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} placement="center" backdrop="blur" size="2xl" scrollBehavior="inside">
      <ModalContent className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/92 shadow-[0_30px_90px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/92 dark:shadow-none">
        <ModalHeader className="flex flex-col gap-1 border-b border-slate-200/80 px-6 pb-5 pt-6 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
              <User size={24} />
            </div>
            <div className="min-w-0">
              <div className="tm-section-label">{t("modeCreate")}</div>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{t("title")}</h2>
            </div>
          </div>
        </ModalHeader>

        <ModalBody className="px-6 py-5">
          <div className="space-y-5">
            <Card className="tm-card-grid rounded-[1.5rem]">
              <CardBody className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="tm-section-label">{t("previewLabel")}</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {previewAddress || t("autoModeLabel")}
                    </div>
                    <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                      {isAutoGenerateMode ? t("autoModeHint") : t("manualModeHint")}
                    </p>
                  </div>
                  <div className="tm-chip-strong">
                    <Sparkles size={13} />
                    {isAutoGenerateMode ? t("autoModeLabel") : t("manualModeLabel")}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="tm-chip">
                    <Mail size={12} />
                    {previewAddress || t("previewPending")}
                  </span>
                  <span className="tm-chip">
                    <KeyRound size={12} />
                    {t("expiresLabel")}
                  </span>
                </div>
              </CardBody>
            </Card>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(14rem,0.9fr)]">
              <div className="space-y-4">
                <div className="space-y-3">
                  <Input
                    label={t("usernameLabel")}
                    placeholder="johndoe"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    isDisabled={isLoading}
                    variant="bordered"
                    classNames={TM_INPUT_CLASSNAMES}
                  />
                  <DomainSelector
                    value={selectedDomain}
                    onSelectionChange={setSelectedDomain}
                    isDisabled={isLoading}
                  />
                  {!isAutoGenerateMode && !username && <p className="text-xs text-rose-500">{tc("required")}</p>}
                  {usernameError && <p className="text-xs text-rose-500">{usernameError}</p>}
                </div>

                <div>
                  <Input
                    label={t("passwordLabel")}
                    type={isPasswordVisible ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    isDisabled={isLoading}
                    variant="bordered"
                    classNames={TM_INPUT_CLASSNAMES}
                    endContent={
                      <button
                        type="button"
                        onClick={() => setIsPasswordVisible((value) => !value)}
                        className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        {isPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                  />
                  {passwordError && <p className="mt-1 text-xs text-rose-500">{passwordError}</p>}
                </div>
                {emailOtpEnabled && !isAutoGenerateMode && (
                  <div className="space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <Input
                        label={t("otpLabel")}
                        value={otpCode}
                        onChange={(event) => setOtpCode(event.target.value)}
                        isDisabled={isLoading}
                        variant="bordered"
                        autoComplete="one-time-code"
                        classNames={TM_INPUT_CLASSNAMES}
                      />
                      <Button
                        variant="bordered"
                        onPress={handleSendOtp}
                        isLoading={isSendingOtp}
                        isDisabled={isLoading || otpCooldown > 0}
                        className="rounded-full"
                      >
                        {otpCooldown > 0
                          ? t("otpSendCooldown", { seconds: otpCooldown })
                          : t("otpSend")}
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t("otpHint")}</p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <Select
                  label={t("expiresLabel")}
                  selectedKeys={[expiresIn]}
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as string
                    if (value) setExpiresIn(value)
                  }}
                  isDisabled={isLoading}
                  aria-label={t("expiresLabel")}
                  variant="bordered"
                  classNames={TM_SELECT_CLASSNAMES}
                >
                  <SelectItem key="0">{t("expiresNever")}</SelectItem>
                  <SelectItem key="3600">{t("expires1h")}</SelectItem>
                  <SelectItem key="21600">{t("expires6h")}</SelectItem>
                  <SelectItem key="86400">{t("expires24h")}</SelectItem>
                  <SelectItem key="259200">{t("expires3d")}</SelectItem>
                  <SelectItem key="604800">{t("expires7d")}</SelectItem>
                </Select>

                <Card className="border border-amber-200 bg-amber-50/85 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <CardBody className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
                        <AlertCircle size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{t("importantNotice")}</p>
                        <p className="mt-1 text-sm leading-7 text-amber-800 dark:text-amber-200">{t("noPasswordRecovery")}</p>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </div>
            </div>

            {error && (
              <Card className="border border-rose-200 bg-rose-50/85 dark:border-rose-900/60 dark:bg-rose-950/30">
                <CardBody className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">
                      <AlertCircle size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">{t("creationFailed")}</p>
                      <p className="mt-1 text-sm leading-7 text-rose-800 dark:text-rose-200">{error}</p>
                      {showLoginOption && (
                        <Button
                          size="sm"
                          variant="flat"
                          color="primary"
                          onPress={handleTryLogin}
                          isLoading={isLoading}
                          startContent={<User size={14} />}
                          className="mt-3 rounded-full"
                        >
                          {t("tryLogin")}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        </ModalBody>

        <ModalFooter className="border-t border-slate-200/80 px-6 py-5 dark:border-slate-800">
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="bordered" onPress={handleClose} isDisabled={isLoading} className="rounded-full">
              {tc("cancel")}
            </Button>
            <Button color="primary" onPress={handleSubmit} isLoading={isLoading} isDisabled={!effectiveCanSubmit} className="rounded-full">
              {tc("create")}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
