"use client"

import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal"
import { Button } from "@heroui/button"
import { Card, CardBody } from "@heroui/card"
import { Bell, Database, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react"

import type { PublicNoticeTone, PublicUpdateNotice } from "@/lib/api"

interface UpdateNoticeModalProps {
  isOpen: boolean
  onClose: () => void
  notice: PublicUpdateNotice | null
  locale: string
}

const SECTION_STYLES: Record<
  PublicNoticeTone,
  {
    cardClassName: string
    iconWrapperClassName: string
    iconClassName: string
    titleClassName: string
    textClassName: string
    Icon: typeof Database
  }
> = {
  info: {
    cardClassName: "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800",
    iconWrapperClassName: "bg-blue-100 dark:bg-blue-800/50",
    iconClassName: "text-blue-600 dark:text-blue-400",
    titleClassName: "text-blue-800 dark:text-blue-200",
    textClassName: "text-blue-700 dark:text-blue-300",
    Icon: Database,
  },
  warning: {
    cardClassName: "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800",
    iconWrapperClassName: "bg-amber-100 dark:bg-amber-800/50",
    iconClassName: "text-amber-600 dark:text-amber-400",
    titleClassName: "text-amber-800 dark:text-amber-200",
    textClassName: "text-amber-700 dark:text-amber-300",
    Icon: AlertCircle,
  },
  success: {
    cardClassName: "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800",
    iconWrapperClassName: "bg-green-100 dark:bg-green-800/50",
    iconClassName: "text-green-600 dark:text-green-400",
    titleClassName: "text-green-800 dark:text-green-200",
    textClassName: "text-green-700 dark:text-green-300",
    Icon: CheckCircle2,
  },
}

export default function UpdateNoticeModal({ isOpen, onClose, notice, locale }: UpdateNoticeModalProps) {
  if (!notice?.enabled) {
    return null
  }

  const content = locale.startsWith("zh") ? notice.zh : notice.en

  return (
    <Modal isOpen={isOpen} onClose={onClose} placement="center" backdrop="blur" size="lg" scrollBehavior="inside">
      <ModalContent className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/92 shadow-[0_30px_90px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/92 dark:shadow-none">
        <ModalHeader className="flex flex-col gap-1 border-b border-slate-200/80 px-6 pb-5 pt-6 dark:border-slate-800">
          <div className="flex justify-center mb-2">
            <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-[1.25rem] flex items-center justify-center">
              <Bell size={28} className="text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-center">{content.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{content.dateLabel}</p>
        </ModalHeader>
        <ModalBody className="px-6 py-5">
          <div className="space-y-4">
            {content.sections.map((section, index) => {
              const styles = SECTION_STYLES[section.tone]
              const bullets = section.bullets ?? []
              const Icon = styles.Icon

              return (
                <Card key={`${section.tone}-${index}-${section.title}`} className={`${styles.cardClassName} rounded-[1.4rem]`}>
                  <CardBody className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${styles.iconWrapperClassName}`}>
                        <Icon size={16} className={styles.iconClassName} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className={`font-medium mb-2 ${styles.titleClassName}`}>{section.title}</h3>
                        {section.body && (
                          <p className={`text-sm leading-relaxed ${styles.textClassName}`}>{section.body}</p>
                        )}
                        {bullets.length > 0 && (
                          <ul className={`text-sm leading-relaxed space-y-1.5 ${styles.textClassName} ${section.body ? "mt-3" : ""}`}>
                            {bullets.map((bullet, bulletIndex) => (
                              <li key={`${section.title}-${bulletIndex}`} className="flex items-start gap-2">
                                <ArrowRight size={14} className="mt-0.5 flex-shrink-0" />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )
            })}

            {content.footer && (
              <div className="text-center text-sm text-gray-500 dark:text-gray-400 pt-2">
                <p>{content.footer}</p>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter className="border-t border-slate-200/80 px-6 py-5 dark:border-slate-800">
          <Button color="primary" onPress={onClose} className="w-full rounded-full">{content.dismissLabel}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
