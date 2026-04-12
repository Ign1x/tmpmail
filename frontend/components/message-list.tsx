"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Avatar } from "@heroui/avatar"
import { Button } from "@heroui/button"
import { Card, CardBody } from "@heroui/card"
import { AlertCircle, ArrowUpRight, Clock3, FileText, Inbox, Mail, Paperclip, RefreshCw } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { enUS, zhCN } from "date-fns/locale"
import { useLocale, useTranslations } from "next-intl"
import { useAuth } from "@/contexts/auth-context"
import { useMailStatus } from "@/contexts/mail-status-context"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import { useMailChecker } from "@/hooks/use-mail-checker"
import { useIsMobile } from "@/hooks/use-mobile"
import { getMessages } from "@/lib/api"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"
import type { Message } from "@/types"

interface MessageListProps {
  onSelectMessage: (message: Message) => void
  refreshKey?: number
}

type FetchMode = "initial" | "refresh"
const INITIAL_INBOX_LOAD_GUARD_MS = 10_000

function LoadingSkeleton({ isMobile }: { isMobile: boolean }) {
  return (
    <div className={`h-full w-full overflow-y-auto ${isMobile ? "p-2" : "p-4"}`}>
      <div className="border-b border-slate-200/80 px-1 pb-4 dark:border-slate-800/80">
        <div className="flex items-center justify-between gap-3">
          <div className="h-7 w-24 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
          <div className="h-8 w-20 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-8 w-20 animate-pulse rounded-full bg-slate-100 dark:bg-slate-900/80" />
          ))}
        </div>
      </div>

      <div className={`mt-4 ${isMobile ? "space-y-2" : "space-y-4"}`}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-[1.7rem] border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/60"
          >
            <div className="flex items-start gap-4">
              <div className="h-11 w-11 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="h-4 w-32 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
                  <div className="h-3 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-900" />
                </div>
                <div className="h-4 w-48 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
                <div className="h-3 w-full animate-pulse rounded-full bg-slate-100 dark:bg-slate-900" />
                <div className="h-3 w-5/6 animate-pulse rounded-full bg-slate-100 dark:bg-slate-900" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatMessageSize(size: number) {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 102.4) / 10)} KB`
  }

  return `${Math.round(size / 1024 / 102.4) / 10} MB`
}

export default function MessageList({ onSelectMessage, refreshKey }: MessageListProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { token, currentAccount } = useAuth()
  const { toast } = useHeroUIToast()
  const { isEnabled, connectionState, lastCheckTime, newMessageCount } = useMailStatus()
  const isMobile = useIsMobile()
  const t = useTranslations("messageList")
  const td = useTranslations("messageDetail")
  const locale = useLocale()
  const messageCountRef = useRef(0)
  const fetchRequestIdRef = useRef(0)
  const lastHandledRefreshKeyRef = useRef(refreshKey ?? 0)
  const lastAccountIdRef = useRef(currentAccount?.id ?? null)

  useEffect(() => {
    messageCountRef.current = messages.length
  }, [messages.length])

  useEffect(() => {
    return () => {
      fetchRequestIdRef.current += 1
    }
  }, [])

  const fetchInbox = useCallback(
    async (mode: FetchMode) => {
      const requestId = ++fetchRequestIdRef.current
      let initialLoadGuardId: ReturnType<typeof globalThis.setTimeout> | null = null
      if (!token || !currentAccount) {
        setMessages([])
        setError(null)
        setIsInitialLoading(false)
        setIsRefreshing(false)
        return
      }

      if (mode === "initial") {
        setIsInitialLoading(true)
        initialLoadGuardId = globalThis.setTimeout(() => {
          if (fetchRequestIdRef.current !== requestId) {
            return
          }

          setIsInitialLoading(false)
          setError(t("fetchError"))
        }, INITIAL_INBOX_LOAD_GUARD_MS)
      } else {
        setIsRefreshing(true)
      }

      try {
        const providerId = currentAccount.providerId || DEFAULT_PROVIDER_ID
        const { messages: fetchedMessages } = await getMessages(token, 1, providerId)

        if (fetchRequestIdRef.current !== requestId) {
          return
        }

        setMessages(fetchedMessages || [])
        setError(null)
      } catch (err) {
        if (fetchRequestIdRef.current !== requestId) {
          return
        }

        console.error("Failed to fetch messages:", err)
        setError(mode === "refresh" ? t("refreshError") : t("fetchError"))

        if (mode === "initial" || messageCountRef.current === 0) {
          setMessages([])
        }
      } finally {
        if (initialLoadGuardId) {
          globalThis.clearTimeout(initialLoadGuardId)
        }

        if (fetchRequestIdRef.current !== requestId) {
          return
        }

        if (mode === "initial") {
          setIsInitialLoading(false)
        } else {
          setIsRefreshing(false)
        }
      }
    },
    [currentAccount, t, token],
  )

  const handleNewMessage = useCallback(
    (message: Message) => {
      toast({
        title: t("newEmail"),
        description: `${t("from")}: ${message.from.address}`,
        color: "success",
        variant: "flat",
        icon: <Mail size={16} />,
      })
    },
    [t, toast],
  )

  const handleMessagesUpdate = useCallback((nextMessages: Message[]) => {
    setMessages(nextMessages)
    setError(null)
    setIsInitialLoading(false)
    setIsRefreshing(false)
  }, [])

  const manualRefresh = useCallback(async () => {
    await fetchInbox("refresh")
  }, [fetchInbox])

  useMailChecker({
    currentMessages: messages,
    onNewMessage: handleNewMessage,
    onMessagesUpdate: handleMessagesUpdate,
    enabled: isEnabled,
  })

  useEffect(() => {
    void fetchInbox("initial")
  }, [fetchInbox, currentAccount?.id])

  useEffect(() => {
    const nextRefreshKey = refreshKey ?? 0
    const accountId = currentAccount?.id ?? null

    if (lastAccountIdRef.current !== accountId) {
      lastAccountIdRef.current = accountId
      lastHandledRefreshKeyRef.current = nextRefreshKey
    }

    if (nextRefreshKey <= 0) {
      return
    }

    if (isInitialLoading) {
      return
    }

    if (nextRefreshKey === lastHandledRefreshKeyRef.current) {
      return
    }

    lastHandledRefreshKeyRef.current = nextRefreshKey
    void manualRefresh()
  }, [currentAccount?.id, isInitialLoading, manualRefresh, refreshKey])

  const activityLocale = locale === "en" ? enUS : zhCN
  const relativeLastCheck = lastCheckTime
    ? formatDistanceToNow(lastCheckTime, {
        addSuffix: true,
        locale: activityLocale,
      })
    : null

  const unreadCount = messages.filter((message) => !message.seen).length
  const attachmentCount = messages.filter((message) => message.hasAttachments).length
  const streamLabel =
    !isEnabled
      ? t("streamPaused")
      : connectionState === "connected"
        ? t("streamConnected")
        : connectionState === "reconnecting"
          ? t("streamReconnecting")
          : connectionState === "error"
            ? t("streamError")
            : t("streamConnecting")

  const streamTone =
    !isEnabled
      ? "border-slate-200 bg-white/80 text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300"
      : connectionState === "connected"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
        : connectionState === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
          : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"

  const renderHeader = () => (
    <div className={`sticky ${isMobile ? "top-0 -mx-2 px-2" : "top-0 -mx-4 px-4"} z-10 mb-4 bg-gradient-to-b from-slate-50/95 via-slate-50/90 to-transparent pb-4 pt-1 backdrop-blur-sm dark:from-slate-950/95 dark:via-slate-950/85`}>
      <div className="border-b border-slate-200/80 px-1 pb-3 dark:border-slate-800/80">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`${isMobile ? "text-lg" : "text-xl"} font-bold text-slate-900 dark:text-slate-100`}>
                {t("inbox")}
              </h2>
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${streamTone}`}>
                <span className={`h-2 w-2 rounded-full ${isEnabled ? "bg-current" : "bg-slate-400"}`} />
                {streamLabel}
              </div>
            </div>
          </div>

          <Button
            size="sm"
            variant="flat"
            className="rounded-full bg-white/82 text-slate-700 shadow-sm backdrop-blur dark:bg-slate-900/82 dark:text-slate-200"
            startContent={<RefreshCw size={14} className={isRefreshing ? "animate-spin" : undefined} />}
            onPress={() => void manualRefresh()}
            isDisabled={isRefreshing || isInitialLoading}
          >
            {isRefreshing ? t("refreshingInline") : t("retry")}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
          {relativeLastCheck && (
            <span className="tm-chip">
              <Clock3 size={12} />
              {t("lastChecked", { time: relativeLastCheck })}
            </span>
          )}
          {newMessageCount > 0 && (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-200">
              {t("newMessagesBadge", { count: newMessageCount })}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/75 px-3 py-1 text-slate-700 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200">
            <FileText size={12} />
            <span className="font-semibold">{messages.length}</span>
            <span>{t("messageCount")}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/75 px-3 py-1 text-slate-700 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200">
            <Mail size={12} />
            <span className="font-semibold">{unreadCount}</span>
            <span>{t("new")}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/75 px-3 py-1 text-slate-700 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200">
            <Paperclip size={12} />
            <span className="font-semibold">{attachmentCount}</span>
            <span>{td("attachments")}</span>
          </span>
        </div>
      </div>
    </div>
  )

  if (isInitialLoading) {
    return <LoadingSkeleton isMobile={isMobile} />
  }

  if (error && messages.length === 0) {
    return (
      <div className={`h-full overflow-y-auto ${isMobile ? "p-2" : "p-4"}`}>
        {renderHeader()}
        <div className="flex min-h-[18rem] items-center justify-center">
          <div className="max-w-md rounded-[1.75rem] border border-amber-200 bg-amber-50/80 p-6 text-center shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200">
              <AlertCircle className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{error}</p>
            <Button
              className="mt-5 rounded-full"
              color="warning"
              variant="flat"
              startContent={<RefreshCw size={14} />}
              onPress={() => void manualRefresh()}
              isLoading={isRefreshing}
            >
              {t("retry")}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className={`h-full overflow-y-auto ${isMobile ? "p-2" : "p-4"}`}>
        {renderHeader()}
        <div className="tm-glass-panel flex min-h-[18rem] flex-col items-center justify-center rounded-[1.75rem] p-6 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-900 dark:text-slate-500">
            <Inbox className="h-10 w-10" />
          </div>
          <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200">{t("emptyTitle")}</h3>
          <Button
            className="mt-5 rounded-full"
            variant="flat"
            startContent={<RefreshCw size={14} />}
            onPress={() => void manualRefresh()}
            isLoading={isRefreshing}
          >
            {t("retry")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={`h-full w-full overflow-y-auto ${isMobile ? "p-2" : "p-4"}`}>
      {renderHeader()}

      {error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border border-amber-200 bg-amber-50/85 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <Button
            size="sm"
            variant="flat"
            color="warning"
            startContent={<RefreshCw size={14} />}
            onPress={() => void manualRefresh()}
            isLoading={isRefreshing}
          >
            {t("retry")}
          </Button>
        </div>
      )}

      <div className={`${isMobile ? "space-y-2" : "space-y-4"} w-full`}>
        {messages.map((message) => {
          const senderName = message.from.name || message.from.address
          const isUnread = !message.seen

          return (
            <Card
              key={message.id}
              isPressable
              onPress={() => onSelectMessage(message)}
              aria-label={`${senderName} ${message.subject}`}
              className={`group w-full cursor-pointer overflow-hidden rounded-[1.7rem] transition-all duration-200 ${
                isUnread
                  ? "border border-sky-200 bg-gradient-to-r from-sky-50/95 via-white to-white shadow-[0_18px_50px_rgba(14,165,233,0.12)] hover:-translate-y-0.5 hover:shadow-[0_24px_64px_rgba(14,165,233,0.18)] dark:border-sky-900/60 dark:from-sky-950/30 dark:via-slate-950 dark:to-slate-950"
                  : "border border-slate-200 bg-white/88 shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/62 dark:hover:border-slate-700"
              }`}
            >
              <CardBody className={`${isMobile ? "p-3" : "p-5"} relative w-full`}>
                {isUnread && <div className="absolute inset-y-4 left-0 w-1 rounded-full bg-sky-500" />}

                <div className={`flex items-start ${isMobile ? "gap-3" : "gap-4"} w-full`}>
                  <div className="relative pt-0.5">
                    <Avatar
                      name={senderName.charAt(0).toUpperCase()}
                      className={`flex-shrink-0 font-semibold ${
                        isUnread
                          ? "bg-sky-500 text-white shadow-lg"
                          : "bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                      }`}
                      size={isMobile ? "md" : "lg"}
                    />
                    {isUnread && (
                      <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-sky-500 dark:border-slate-950" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3
                            className={`${isMobile ? "text-sm" : "text-base"} truncate ${
                              isUnread
                                ? "font-bold text-slate-900 dark:text-white"
                                : "font-semibold text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {senderName}
                          </h3>
                          {isUnread && (
                            <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                              {t("new")}
                            </span>
                          )}
                        </div>
                        {message.from.name &&
                          message.from.address &&
                          message.from.address !== message.from.name && (
                            <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                              {message.from.address}
                            </p>
                          )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`text-xs ${
                            isUnread
                              ? "font-medium text-sky-600 dark:text-sky-300"
                              : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {formatDistanceToNow(new Date(message.createdAt), {
                            addSuffix: true,
                            locale: activityLocale,
                          })}
                        </span>
                        <ArrowUpRight
                          size={16}
                          className="text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-300"
                        />
                      </div>
                    </div>

                    <p
                      className={`${isMobile ? "mt-2 text-sm" : "mt-2 text-base"} truncate ${
                        isUnread
                          ? "font-semibold text-slate-800 dark:text-slate-200"
                          : "font-medium text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {message.subject}
                    </p>

                    <p
                      className={`${isMobile ? "mt-2 text-xs" : "mt-3 text-sm"} line-clamp-2 leading-relaxed ${
                        isUnread
                          ? "text-slate-700 dark:text-slate-300"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {message.intro}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {message.hasAttachments && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-900">
                          <Paperclip size={11} />
                          {td("attachments")}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-900">
                        <FileText size={11} />
                        {formatMessageSize(message.size)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
