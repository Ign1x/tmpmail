"use client"

import { useEffect, useState } from "react"
import { Button } from "@heroui/button"
import { Card, CardBody } from "@heroui/card"
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal"
import { AlertCircle, Eye, EyeOff, LogIn, Mail, User } from "lucide-react"
import { useTranslations } from "next-intl"
import { DomainSelector } from "@/components/domain-selector"
import { TM_INPUT_CLASSNAMES } from "@/components/heroui-field-styles"
import { Input } from "@/components/tm-form-fields"
import { useAuth } from "@/contexts/auth-context"
import { EXAMPLE_EMAIL } from "@/lib/provider-config"
import {
  normalizeEmailAddress,
  normalizeLocalPart,
  validateEmailAddress,
  validateLocalPart,
} from "@/lib/account-validation"

interface LoginModalProps {
  isOpen: boolean
  onClose: () => void
  accountAddress?: string
}

export default function LoginModal({ isOpen, onClose, accountAddress }: LoginModalProps) {
  const [address, setAddress] = useState(accountAddress || "")
  const [username, setUsername] = useState("")
  const [selectedDomain, setSelectedDomain] = useState<string>("")
  const [loginMode, setLoginMode] = useState<"split" | "full">("split")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const { login } = useAuth()
  const t = useTranslations("loginModal")
  const tc = useTranslations("common")
  const normalizedAddress = normalizeEmailAddress(address)
  const normalizedUsername = normalizeLocalPart(username)
  const previewAddress =
    loginMode === "full"
      ? normalizedAddress || t("previewPending")
      : normalizedUsername && selectedDomain
        ? `${normalizedUsername}@${selectedDomain}`
        : selectedDomain
          ? `${t("previewRandom")}@${selectedDomain}`
          : t("previewPending")

  const usernameError =
    loginMode !== "split" || !username
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

  const addressError =
    loginMode !== "full" || !address
      ? null
      : (() => {
          switch (validateEmailAddress(normalizedAddress)) {
            case "tooShort":
              return t("usernameTooShort")
            case "tooLong":
              return t("usernameTooLong")
            case "invalid":
              return t("emailInvalid")
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

  useEffect(() => {
    if (!isOpen) return

    if (accountAddress) {
      const normalizedAccountAddress = normalizeEmailAddress(accountAddress)
      setAddress(normalizedAccountAddress)
      const parts = normalizedAccountAddress.split("@")
      if (parts.length === 2) {
        setUsername(parts[0])
        setSelectedDomain(parts[1])
      } else {
        setUsername(accountAddress)
        setSelectedDomain("")
      }
      setLoginMode("split")
    } else {
      setLoginMode("split")
    }
  }, [accountAddress, isOpen])

  const canSubmit =
    !!password &&
    !passwordError &&
    (loginMode === "full"
      ? !!normalizedAddress && !addressError
      : !!normalizedUsername && !!selectedDomain && !usernameError)

  const handleSubmit = async () => {
    setIsLoading(true)
    setError(null)

    let loginAddress = normalizedAddress

    if (loginMode === "split") {
      if (!normalizedUsername || !selectedDomain) {
        setIsLoading(false)
        setError(t("fillUsernameAndDomain"))
        return
      }
      if (usernameError) {
        setIsLoading(false)
        setError(usernameError)
        return
      }
      loginAddress = `${normalizedUsername}@${selectedDomain}`
    } else {
      if (!normalizedAddress) {
        setIsLoading(false)
        setError(t("fillEmailAndPassword"))
        return
      }
      if (addressError) {
        setIsLoading(false)
        setError(addressError)
        return
      }
    }

    if (passwordError) {
      setIsLoading(false)
      setError(passwordError)
      return
    }

    try {
      await login(loginAddress, password)
      onClose()
      setAddress("")
      setUsername("")
      setSelectedDomain("")
      setPassword("")
      setError(null)
    } catch (error: unknown) {
      if (error instanceof Error) {
        setError(error.message || t("loginFailed"))
      } else {
        setError(t("loginFailed"))
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    onClose()
    setError(null)
    setPassword("")
    setIsPasswordVisible(false)
    if (!accountAddress) {
      setAddress("")
      setUsername("")
      setSelectedDomain("")
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} placement="center" backdrop="blur" size="2xl" scrollBehavior="inside">
      <ModalContent className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/92 shadow-[0_30px_90px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/92 dark:shadow-none">
        <ModalHeader className="flex flex-col gap-1 border-b border-slate-200/80 px-6 pb-5 pt-6 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
              <LogIn size={24} />
            </div>
            <div className="min-w-0">
              <div className="tm-section-label">{t("modeLogin")}</div>
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
                    <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{previewAddress}</div>
                  </div>
                  <div className="inline-flex rounded-full border border-slate-200 bg-slate-100/90 p-1 dark:border-slate-800 dark:bg-slate-900/70">
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        loginMode === "split"
                          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                      onClick={() => setLoginMode("split")}
                      disabled={isLoading}
                    >
                      {t("splitMode")}
                    </button>
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        loginMode === "full"
                          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                      onClick={() => setLoginMode("full")}
                      disabled={isLoading}
                    >
                      {t("fullMode")}
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="tm-chip">
                    <Mail size={12} />
                    {previewAddress}
                  </span>
                  <span className="tm-chip">
                    <User size={12} />
                    {loginMode === "split" ? t("splitMode") : t("fullMode")}
                  </span>
                </div>
              </CardBody>
            </Card>

            <div className="space-y-4">
              {loginMode === "full" ? (
                <div>
                  <Input
                    type="email"
                    label={t("emailLabel")}
                    placeholder={EXAMPLE_EMAIL}
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    isDisabled={isLoading || !!accountAddress}
                    variant="bordered"
                    classNames={TM_INPUT_CLASSNAMES}
                  />
                  {addressError && <p className="mt-1 text-xs text-rose-500">{addressError}</p>}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(14rem,0.9fr)]">
                  <div>
                    <Input
                      type="text"
                      label={t("usernameLabel")}
                      placeholder={t("usernamePlaceholder")}
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      isDisabled={isLoading || !!accountAddress}
                      variant="bordered"
                      classNames={TM_INPUT_CLASSNAMES}
                    />
                    {usernameError && <p className="mt-1 text-xs text-rose-500">{usernameError}</p>}
                  </div>
                  <DomainSelector
                    value={selectedDomain}
                    onSelectionChange={(domain) => {
                      setSelectedDomain(domain)
                    }}
                    isDisabled={isLoading}
                  />
                </div>
              )}

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

              {error && (
                <Card className="border border-rose-200 bg-rose-50/85 dark:border-rose-900/60 dark:bg-rose-950/30">
                  <CardBody className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">
                        <AlertCircle size={18} />
                      </div>
                      <p className="text-sm leading-7 text-rose-800 dark:text-rose-200">{error}</p>
                    </div>
                  </CardBody>
                </Card>
              )}
            </div>
          </div>
        </ModalBody>

        <ModalFooter className="border-t border-slate-200/80 px-6 py-5 dark:border-slate-800">
          <div className="flex w-full justify-end">
            <Button color="primary" onPress={handleSubmit} isLoading={isLoading} isDisabled={!canSubmit} className="rounded-full">
              {tc("login")}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
