"use client"

import { Button } from "@heroui/button"
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal"
import { AlertTriangle, PencilLine } from "lucide-react"

import { Input } from "@/components/tm-form-fields"

type ConsoleActionTone = "primary" | "danger"

interface ConsoleActionModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  cancelLabel: string
  confirmLabel: string
  tone?: ConsoleActionTone
  inputLabel?: string
  inputType?: "text" | "password" | "number"
  inputValue?: string
  inputPlaceholder?: string
  inputMode?: "text" | "numeric" | "decimal" | "email" | "search" | "tel" | "url" | "none"
  errorMessage?: string | null
  onInputValueChange?: (value: string) => void
}

const TONE_STYLES: Record<
  ConsoleActionTone,
  {
    Icon: typeof AlertTriangle
    iconWrapperClassName: string
    iconClassName: string
    confirmClassName: string
  }
> = {
  primary: {
    Icon: PencilLine,
    iconWrapperClassName: "bg-sky-100 dark:bg-sky-950/50",
    iconClassName: "text-sky-600 dark:text-sky-300",
    confirmClassName: "bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500",
  },
  danger: {
    Icon: AlertTriangle,
    iconWrapperClassName: "bg-rose-100 dark:bg-rose-950/45",
    iconClassName: "text-rose-600 dark:text-rose-300",
    confirmClassName: "bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500",
  },
}

export default function ConsoleActionModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  cancelLabel,
  confirmLabel,
  tone = "primary",
  inputLabel,
  inputType = "text",
  inputValue,
  inputPlaceholder,
  inputMode,
  errorMessage,
  onInputValueChange,
}: ConsoleActionModalProps) {
  const styles = TONE_STYLES[tone]
  const Icon = styles.Icon
  const hasInput = typeof onInputValueChange === "function"
  const hasBodyContent = hasInput || Boolean(errorMessage)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      placement="center"
      backdrop="blur"
      size="lg"
      scrollBehavior="inside"
    >
      <ModalContent className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/92 shadow-[0_30px_90px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/92 dark:shadow-none">
        <ModalHeader className="flex flex-col gap-1 border-b border-slate-200/80 px-6 pb-5 pt-6 dark:border-slate-800">
          <div className="mb-3 flex justify-center">
            <div className={`flex h-14 w-14 items-center justify-center rounded-[1.25rem] ${styles.iconWrapperClassName}`}>
              <Icon size={24} className={styles.iconClassName} />
            </div>
          </div>
          <h2 className="text-center text-xl font-semibold text-slate-950 dark:text-white">{title}</h2>
          {description ? (
            <p className="mt-2 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
              {description}
            </p>
          ) : null}
        </ModalHeader>

        {hasBodyContent ? (
          <ModalBody className="px-6 py-5">
            {hasInput ? (
              <div className="space-y-3">
                <Input
                  autoFocus
                  label={inputLabel}
                  type={inputType}
                  inputMode={inputMode}
                  value={inputValue ?? ""}
                  onValueChange={onInputValueChange}
                  placeholder={inputPlaceholder}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      onConfirm()
                    }
                  }}
                />
                {errorMessage ? (
                  <p className="text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
                ) : null}
              </div>
            ) : errorMessage ? (
              <p className="text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p>
            ) : null}
          </ModalBody>
        ) : null}

        <ModalFooter className="border-t border-slate-200/80 px-6 py-5 dark:border-slate-800">
          <Button variant="flat" className="rounded-full" onPress={onClose}>
            {cancelLabel}
          </Button>
          <Button className={`rounded-full ${styles.confirmClassName}`} onPress={onConfirm}>
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
