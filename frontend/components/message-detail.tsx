"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Avatar } from "@heroui/avatar"
import { Button } from "@heroui/button"
import { Card, CardBody } from "@heroui/card"
import { Spinner } from "@heroui/spinner"
import {
  ArrowLeft,
  CheckCircle,
  Clock3,
  Download,
  FileText,
  Mail,
  Paperclip,
  Trash2,
  XCircle,
} from "lucide-react"
import { format } from "date-fns"
import { enUS, zhCN } from "date-fns/locale"
import { useLocale, useTranslations } from "next-intl"
import {
  deleteMessage as apiDeleteMessage,
  downloadMessageAttachment,
  downloadMessageSource,
  getMessage,
  markMessageAsRead,
} from "@/lib/api"
import { useAuth } from "@/contexts/auth-context"
import { useIsMobile } from "@/hooks/use-mobile"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"
import type { Message, MessageDetail as MessageDetailType } from "@/types"

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 102.4) / 10)} KB`
  }

  return `${Math.round(size / 1024 / 102.4) / 10} MB`
}

function EmailContent({ html, text, isMobile }: { html?: string[]; text?: string; isMobile: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeHeight, setIframeHeight] = useState(240)
  const resizeTimeoutIdsRef = useRef<number[]>([])
  const hasHtml = Boolean(html && html.some((part) => part.trim()))

  const clearResizeTimeouts = useCallback(() => {
    resizeTimeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    resizeTimeoutIdsRef.current = []
  }, [])

  const adjustIframeHeight = useCallback(() => {
    const iframe = iframeRef.current
    if (iframe?.contentWindow?.document?.body) {
      const body = iframe.contentWindow.document.body
      const htmlElement = iframe.contentWindow.document.documentElement
      const height = Math.max(body.scrollHeight, body.offsetHeight, htmlElement.scrollHeight)
      if (height > 0) {
        setIframeHeight(height + 24)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasHtml) {
      clearResizeTimeouts()
      return
    }

    const iframe = iframeRef.current
    if (!iframe) return

    const content = html?.join("") ?? ""

    const wrappedContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          :root {
            color-scheme: light;
          }

          html {
            overflow-x: hidden;
            background: #ffffff;
          }

          body {
            margin: 0;
            padding: ${isMobile ? "16px" : "20px"};
            font-family: Inter, "Segoe UI", Arial, sans-serif;
            font-size: ${isMobile ? "14px" : "15px"};
            line-height: 1.75;
            word-wrap: break-word;
            overflow-wrap: anywhere;
            background: #ffffff;
            color: #0f172a;
          }

          * {
            max-width: 100%;
            box-sizing: border-box;
          }

          img,
          video {
            max-width: 100%;
            height: auto;
            border-radius: 14px;
          }

          table {
            width: 100%;
            max-width: 100%;
            border-collapse: collapse;
          }

          th,
          td {
            border: 1px solid #e2e8f0;
            padding: 8px 10px;
            vertical-align: top;
          }

          blockquote {
            margin: 0;
            padding: 12px 16px;
            border-left: 4px solid #0ea5e9;
            background: #f8fafc;
            border-radius: 0 14px 14px 0;
          }

          a {
            color: #0369a1;
          }

          pre,
          code {
            font-family: "JetBrains Mono", ui-monospace, monospace;
            white-space: pre-wrap;
            word-break: break-word;
          }
        </style>
      </head>
      <body>${content}</body>
      </html>
    `

    const doc = iframe.contentWindow?.document
    if (doc) {
      doc.open()
      doc.write(wrappedContent)
      doc.close()
      iframe.onload = () => adjustIframeHeight()
      clearResizeTimeouts()
      resizeTimeoutIdsRef.current = [120, 500, 900].map((delay) => window.setTimeout(adjustIframeHeight, delay))
    }

    return () => {
      clearResizeTimeouts()
      iframe.onload = null
    }
  }, [adjustIframeHeight, clearResizeTimeouts, hasHtml, html, isMobile])

  if (!hasHtml) {
    return (
      <div className="overflow-hidden rounded-[1.25rem] border border-slate-200/80 bg-white shadow-inner dark:border-slate-800 dark:bg-slate-950/70">
        <div
          className={`whitespace-pre-wrap break-words text-slate-900 dark:text-slate-100 ${
            isMobile ? "px-4 py-4 text-sm leading-7" : "px-5 py-5 text-[15px] leading-8"
          }`}
        >
          {text?.trim() || " "}
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-slate-200/80 bg-white shadow-inner dark:border-slate-800">
      <iframe
        ref={iframeRef}
        title="Email Content"
        sandbox="allow-same-origin"
        style={{
          width: "100%",
          height: `${iframeHeight}px`,
          border: "none",
          display: "block",
          background: "#ffffff",
        }}
      />
    </div>
  )
}

interface MessageDetailProps {
  message: Message
  onBack: () => void
  onDelete: (messageId: string) => void
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="tm-glass-panel flex w-full max-w-md flex-col items-center rounded-[1.8rem] p-8 text-center">
        <Spinner size="lg" color="primary" />
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  )
}

export default function MessageDetail({ message, onBack, onDelete }: MessageDetailProps) {
  const [messageDetail, setMessageDetail] = useState<MessageDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDownloadingSource, setIsDownloadingSource] = useState(false)
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null)
  const { token, currentAccount } = useAuth()
  const { toast } = useHeroUIToast()
  const isMobile = useIsMobile()
  const t = useTranslations("messageDetail")
  const locale = useLocale()
  const providerId = currentAccount?.providerId || DEFAULT_PROVIDER_ID
  const localeDate = locale === "en" ? enUS : zhCN

  useEffect(() => {
    let active = true

    const markSeenInBackground = async (sessionToken: string, messageId: string) => {
      try {
        await markMessageAsRead(sessionToken, messageId, providerId)
        if (!active) {
          return
        }

        setMessageDetail((current) =>
          current && current.id === messageId ? { ...current, seen: true } : current,
        )
      } catch (err) {
        console.error("Failed to mark message as read:", err)
      }
    }

    const fetchMessageDetail = async () => {
      if (!token) {
        if (active) {
          setError(t("authError"))
          setLoading(false)
        }
        return
      }

      try {
        if (active) {
          setLoading(true)
          setError(null)
          setMessageDetail(null)
        }

        const detail = await getMessage(token, message.id, providerId)
        if (!active) {
          return
        }

        setMessageDetail(detail)
        setLoading(false)
        setError(null)

        if (!detail.seen) {
          setMessageDetail((current) =>
            current && current.id === detail.id ? { ...current, seen: true } : current,
          )
          void markSeenInBackground(token, detail.id)
        }
      } catch (err) {
        if (!active) {
          return
        }
        console.error("Failed to fetch message detail:", err)
        setError(t("fetchError"))
        setMessageDetail(null)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void fetchMessageDetail()

    return () => {
      active = false
    }
  }, [message.id, providerId, t, token])

  const handleDelete = async () => {
    if (!token || !messageDetail) return

    try {
      await apiDeleteMessage(token, messageDetail.id, providerId)
      toast({
        title: t("messageDeleted"),
        color: "success",
        variant: "flat",
        icon: <CheckCircle size={16} />,
      })
      onDelete(messageDetail.id)
    } catch (err) {
      console.error("Failed to delete message:", err)
      toast({
        title: t("deleteFailed"),
        color: "danger",
        variant: "flat",
        icon: <XCircle size={16} />,
      })
      setError(t("deleteError"))
    }
  }

  const handleDownloadSource = async () => {
    if (!token || !messageDetail || isDownloadingSource) return

    try {
      setIsDownloadingSource(true)
      await downloadMessageSource(token, messageDetail.id, providerId)
    } catch (err) {
      console.error("Failed to download message source:", err)
      toast({
        title: t("downloadFailed"),
        color: "danger",
        variant: "flat",
        icon: <XCircle size={16} />,
      })
    } finally {
      setIsDownloadingSource(false)
    }
  }

  const handleDownloadAttachment = async (attachmentId: string, filename: string) => {
    if (!token || !messageDetail || downloadingAttachmentId) return

    try {
      setDownloadingAttachmentId(attachmentId)
      await downloadMessageAttachment(token, messageDetail.id, attachmentId, providerId, filename)
    } catch (err) {
      console.error("Failed to download attachment:", err)
      toast({
        title: t("downloadFailed"),
        color: "danger",
        variant: "flat",
        icon: <XCircle size={16} />,
      })
    } finally {
      setDownloadingAttachmentId(null)
    }
  }

  if (loading) {
    return <LoadingState label={t("bodyTitle")} />
  }

  if (error || !messageDetail) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="tm-glass-panel w-full max-w-md rounded-[1.8rem] p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            <XCircle size={24} />
          </div>
          <p className="mt-4 text-sm font-semibold text-rose-700 dark:text-rose-200">{error || t("loadError")}</p>
          <Button variant="flat" onPress={onBack} className="mt-5 rounded-full">
            {t("backToInbox")}
          </Button>
        </div>
      </div>
    )
  }

  const fromName = messageDetail.from.name || messageDetail.from.address
  const formattedDate = format(
    new Date(messageDetail.createdAt),
    locale === "zh" ? "yyyy年MM月dd日 HH:mm" : "MMM d, yyyy HH:mm",
    { locale: localeDate },
  )
  const subject = messageDetail.subject?.trim() || t("noSubject")
  const recipients = messageDetail.to.map((recipient) => recipient.address).join(", ")

  return (
    <div className={`h-full overflow-y-auto ${isMobile ? "p-2" : "p-4 md:p-6"}`}>
      <div className={`mx-auto flex w-full max-w-6xl flex-col ${isMobile ? "gap-3" : "gap-4"}`}>
        <div className={`flex ${isMobile ? "flex-col gap-2" : "items-center justify-between gap-3"}`}>
          <Button
            variant="flat"
            startContent={<ArrowLeft size={17} />}
            onPress={onBack}
            size={isMobile ? "sm" : "md"}
            className="w-fit rounded-full border border-slate-200/80 bg-white/82 px-4 text-slate-700 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/82 dark:text-slate-200"
          >
            {t("back")}
          </Button>

          <div className={`flex ${isMobile ? "gap-2" : "items-center gap-2"}`}>
            {messageDetail.downloadUrl && (
              <Button
                variant="flat"
                color="primary"
                startContent={<Download size={16} />}
                onPress={handleDownloadSource}
                size={isMobile ? "sm" : "md"}
                isLoading={isDownloadingSource}
                className="rounded-full"
              >
                {t("download")} (.eml)
              </Button>
            )}
            <Button
              variant="flat"
              color="danger"
              startContent={<Trash2 size={16} />}
              onPress={handleDelete}
              size={isMobile ? "sm" : "md"}
              className="rounded-full"
            >
              {isMobile ? t("deleteMobile") : t("delete")}
            </Button>
          </div>
        </div>

        <Card className="tm-glass-panel-strong overflow-hidden rounded-[1.9rem]">
          <CardBody className={isMobile ? "p-4" : "p-6"}>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 pb-5 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tm-chip-strong">
                    <Mail size={12} />
                    {messageDetail.seen ? t("readLabel") : t("new")}
                  </span>
                  {messageDetail.hasAttachments && (
                    <span className="tm-chip">
                      <Paperclip size={12} />
                      {t("attachments")} ({messageDetail.attachments?.length || 0})
                    </span>
                  )}
                  <span className="tm-chip">
                    <FileText size={12} />
                    {formatFileSize(messageDetail.size)}
                  </span>
                </div>

                <h1 className={`${isMobile ? "mt-4 text-xl" : "mt-5 text-3xl"} font-semibold tracking-tight text-slate-950 dark:text-white`}>
                  {subject}
                </h1>

                <div className="mt-4 flex items-center gap-3">
                  <Avatar name={fromName.charAt(0).toUpperCase()} size={isMobile ? "sm" : "md"} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{fromName}</p>
                    <p className="truncate text-sm text-slate-500 dark:text-slate-400">{messageDetail.from.address}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:min-w-[16rem] sm:grid-cols-2">
                <div className="tm-stat-card p-4">
                  <div className="tm-section-label">{t("receivedAt")}</div>
                  <div className="mt-2 flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                    <Clock3 size={14} className="text-slate-400" />
                    <span>{formattedDate}</span>
                  </div>
                </div>
                <div className="tm-stat-card p-4">
                  <div className="tm-section-label">{t("messageId")}</div>
                  <div className="mt-2 truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={messageDetail.msgid}>
                    {messageDetail.msgid}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="tm-card-grid rounded-[1.5rem] p-4">
                <div className="tm-section-label">{t("from")}</div>
                <p className="mt-2 break-all text-sm leading-7 text-slate-700 dark:text-slate-300">
                  {messageDetail.from.name
                    ? `${messageDetail.from.name} <${messageDetail.from.address}>`
                    : messageDetail.from.address}
                </p>
              </div>
              <div className="tm-card-grid rounded-[1.5rem] p-4">
                <div className="tm-section-label">{t("to")}</div>
                <p className="mt-2 break-all text-sm leading-7 text-slate-700 dark:text-slate-300">{recipients}</p>
              </div>
              {messageDetail.cc && messageDetail.cc.length > 0 && (
                <div className="tm-card-grid rounded-[1.5rem] p-4">
                  <div className="tm-section-label">{t("cc")}</div>
                  <p className="mt-2 break-all text-sm leading-7 text-slate-700 dark:text-slate-300">
                    {messageDetail.cc.join(", ")}
                  </p>
                </div>
              )}
              {messageDetail.bcc && messageDetail.bcc.length > 0 && (
                <div className="tm-card-grid rounded-[1.5rem] p-4">
                  <div className="tm-section-label">{t("bcc")}</div>
                  <p className="mt-2 break-all text-sm leading-7 text-slate-700 dark:text-slate-300">
                    {messageDetail.bcc.join(", ")}
                  </p>
                </div>
              )}
            </div>

            <div className={`${isMobile ? "mt-5" : "mt-6"}`}>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <Mail size={16} />
                </div>
                <div>
                  <div className="tm-section-label">{t("bodyTitle")}</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{subject}</div>
                </div>
              </div>

              <div className="tm-card-grid mt-3 overflow-hidden rounded-[1.6rem]">
                <EmailContent html={messageDetail.html} text={messageDetail.text} isMobile={isMobile} />
              </div>
            </div>

            {messageDetail.hasAttachments && messageDetail.attachments && messageDetail.attachments.length > 0 && (
              <div className={`${isMobile ? "mt-6" : "mt-8"}`}>
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    <Paperclip size={16} />
                  </div>
                  <div>
                    <div className="tm-section-label">{t("attachments")}</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {t("attachments")} ({messageDetail.attachments.length})
                    </div>
                  </div>
                </div>

                <div className={`mt-3 grid grid-cols-1 ${isMobile ? "gap-2" : "gap-3 md:grid-cols-2 xl:grid-cols-3"}`}>
                  {messageDetail.attachments.map((attachment) => {
                    const extension = attachment.filename.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"
                    return (
                      <Card
                        key={attachment.id}
                        className="tm-card-grid overflow-hidden rounded-[1.4rem] transition-transform duration-200 hover:-translate-y-0.5"
                      >
                        <CardBody className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                                {extension}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200" title={attachment.filename}>
                                  {attachment.filename}
                                </p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                  {attachment.contentType || t("attachmentTypeUnknown")}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <span className="tm-chip">{formatFileSize(attachment.size)}</span>
                                  {attachment.related && <span className="tm-chip">{t("attachmentRelated")}</span>}
                                </div>
                              </div>
                            </div>

                            <Button
                              size="sm"
                              variant="flat"
                              isIconOnly
                              onPress={() => handleDownloadAttachment(attachment.id, attachment.filename)}
                              aria-label={`Download ${attachment.filename}`}
                              className="rounded-full"
                              isLoading={downloadingAttachmentId === attachment.id}
                            >
                              <Download size={16} />
                            </Button>
                          </div>
                        </CardBody>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
