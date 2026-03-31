"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/button";
import { Avatar } from "@heroui/avatar";
import { Card, CardBody } from "@heroui/card";
import { AlertCircle, Clock3, Mail, Paperclip, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";

import { useAuth } from "@/contexts/auth-context";
import { useMailStatus } from "@/contexts/mail-status-context";
import { useHeroUIToast } from "@/hooks/use-heroui-toast";
import { useMailChecker } from "@/hooks/use-mail-checker";
import { useIsMobile } from "@/hooks/use-mobile";
import { getMessages } from "@/lib/api";
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config";
import type { Message } from "@/types";

interface MessageListProps {
  onSelectMessage: (message: Message) => void;
  refreshKey?: number;
}

type FetchMode = "initial" | "refresh";

function LoadingSkeleton({ isMobile }: { isMobile: boolean }) {
  return (
    <div className={`h-full w-full overflow-y-auto ${isMobile ? "p-2" : "p-4"}`}>
      <div className={`${isMobile ? "mb-4" : "mb-6"} space-y-3`}>
        <div className="h-8 w-40 animate-pulse rounded-2xl bg-slate-200/80 dark:bg-slate-800/80" />
        <div className="h-5 w-72 animate-pulse rounded-full bg-slate-100 dark:bg-slate-900/80" />
      </div>

      <div className={`${isMobile ? "space-y-2" : "space-y-4"}`}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/60"
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
  );
}

export default function MessageList({
  onSelectMessage,
  refreshKey,
}: MessageListProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { token, currentAccount } = useAuth();
  const { toast } = useHeroUIToast();
  const { isEnabled, connectionState, lastCheckTime, newMessageCount } =
    useMailStatus();
  const isMobile = useIsMobile();
  const t = useTranslations("messageList");
  const td = useTranslations("messageDetail");
  const locale = useLocale();
  const messageCountRef = useRef(0);
  const fetchRequestIdRef = useRef(0);

  useEffect(() => {
    messageCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    return () => {
      fetchRequestIdRef.current += 1;
    };
  }, []);

  const fetchInbox = useCallback(
    async (mode: FetchMode) => {
      const requestId = ++fetchRequestIdRef.current;
      if (!token || !currentAccount) {
        setMessages([]);
        setError(null);
        setIsInitialLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (mode === "initial") {
        setIsInitialLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const providerId = currentAccount.providerId || DEFAULT_PROVIDER_ID;
        const { messages: fetchedMessages } = await getMessages(
          token,
          1,
          providerId,
        );

        if (fetchRequestIdRef.current !== requestId) {
          return;
        }

        setMessages(fetchedMessages || []);
        setError(null);
      } catch (err) {
        if (fetchRequestIdRef.current !== requestId) {
          return;
        }

        console.error("Failed to fetch messages:", err);
        setError(mode === "refresh" ? t("refreshError") : t("fetchError"));

        if (mode === "initial" || messageCountRef.current === 0) {
          setMessages([]);
        }
      } finally {
        if (fetchRequestIdRef.current !== requestId) {
          return;
        }

        if (mode === "initial") {
          setIsInitialLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [currentAccount, t, token],
  );

  const handleNewMessage = useCallback(
    (message: Message) => {
      toast({
        title: t("newEmail"),
        description: `${t("from")}: ${message.from.address}`,
        color: "success",
        variant: "flat",
        icon: <Mail size={16} />,
      });
    },
    [t, toast],
  );

  const handleMessagesUpdate = useCallback((nextMessages: Message[]) => {
    setMessages(nextMessages);
    setError(null);
    setIsInitialLoading(false);
    setIsRefreshing(false);
  }, []);

  const manualRefresh = useCallback(async () => {
    await fetchInbox("refresh");
  }, [fetchInbox]);

  useMailChecker({
    currentMessages: messages,
    onNewMessage: handleNewMessage,
    onMessagesUpdate: handleMessagesUpdate,
    enabled: isEnabled,
  });

  useEffect(() => {
    void fetchInbox("initial");
  }, [fetchInbox, currentAccount?.id]);

  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      void manualRefresh();
    }
  }, [manualRefresh, refreshKey]);

  const activityLocale = locale === "en" ? enUS : zhCN;
  const relativeLastCheck = lastCheckTime
    ? formatDistanceToNow(lastCheckTime, {
        addSuffix: true,
        locale: activityLocale,
      })
    : null;

  const formatMessageSize = (size: number) => {
    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${Math.max(1, Math.round(size / 102.4) / 10)} KB`;
    }

    return `${Math.round(size / 1024 / 102.4) / 10} MB`;
  };

  const streamLabel = !isEnabled
    ? t("streamPaused")
    : connectionState === "connected"
      ? t("streamConnected")
      : connectionState === "reconnecting"
        ? t("streamReconnecting")
        : connectionState === "error"
          ? t("streamError")
          : t("streamConnecting");

  const renderHeader = () => (
    <div className={`sticky ${isMobile ? "top-0 -mx-2 px-2" : "top-0 -mx-4 px-4"} z-10 mb-4 bg-gradient-to-b from-slate-50/95 via-slate-50/85 to-transparent pb-4 pt-1 backdrop-blur-sm dark:from-slate-950/95 dark:via-slate-950/80`}>
      <div className="rounded-[1.75rem] border border-white/70 bg-white/85 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 dark:shadow-none sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {currentAccount && (
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white/75 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                <Mail size={12} />
                <span className="truncate">{currentAccount.address}</span>
              </div>
            )}
            <div className="mt-3">
              <h2
                className={`${isMobile ? "text-xl" : "text-2xl"} font-bold text-slate-900 dark:text-slate-100`}
              >
                {t("inbox")}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {streamLabel}
              </p>
            </div>
          </div>

          <Button
            size="sm"
            variant="flat"
            className="rounded-full bg-white/80 text-slate-700 shadow-sm backdrop-blur dark:bg-slate-900/80 dark:text-slate-200"
            startContent={
              <RefreshCw
                size={14}
                className={isRefreshing ? "animate-spin" : undefined}
              />
            }
            onPress={() => void manualRefresh()}
            isDisabled={isRefreshing || isInitialLoading}
          >
            {isRefreshing ? t("refreshingInline") : t("retry")}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-semibold ${
              !isEnabled
                ? "border-slate-200 bg-white/80 text-slate-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300"
                : connectionState === "connected"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : connectionState === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
            }`}
          >
            <div
              className={`h-2.5 w-2.5 rounded-full ${
                isEnabled ? "bg-current" : "bg-slate-400"
              }`}
            />
            {streamLabel}
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            {t("messageCount")}: {messages.length}
          </span>
          {newMessageCount > 0 && (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 font-medium text-sky-700 dark:bg-sky-950/60 dark:text-sky-200">
              {t("newMessagesBadge", { count: newMessageCount })}
            </span>
          )}
          {relativeLastCheck && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 font-medium text-slate-500 shadow-sm dark:bg-slate-900/80 dark:text-slate-300">
              <Clock3 size={12} />
              {t("lastChecked", { time: relativeLastCheck })}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  if (isInitialLoading) {
    return <LoadingSkeleton isMobile={isMobile} />;
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
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {error}
            </p>
            <p className="mt-2 text-sm leading-6 text-amber-800 dark:text-amber-200">
              {t("errorHelp")}
            </p>
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
    );
  }

  if (messages.length === 0) {
    return (
      <div className={`h-full overflow-y-auto ${isMobile ? "p-2" : "p-4"}`}>
        {renderHeader()}
        <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-slate-300 bg-white/60 p-6 text-center backdrop-blur dark:border-slate-800 dark:bg-slate-950/40">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-900 dark:text-slate-500">
            <Mail className="h-10 w-10" />
          </div>
          <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
            {t("emptyTitle")}
          </h3>
          <p className="mt-2 max-w-md text-sm leading-7 text-slate-500 dark:text-slate-400">
            {t("emptyDesc")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full w-full overflow-y-auto ${isMobile ? "p-2" : "p-4"}`}>
      {renderHeader()}

      {error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
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
        {messages.map((message) => (
          <Card
            key={message.id}
            isPressable
            onPress={() => onSelectMessage(message)}
            className={`w-full cursor-pointer overflow-hidden transition-all duration-300 ${
              !message.seen
                ? "border-l-4 border-l-sky-500 border-t border-r border-b border-sky-200 bg-gradient-to-r from-sky-50/90 to-white shadow-lg hover:translate-y-[-1px] hover:shadow-xl dark:border-sky-900 dark:from-sky-950/40 dark:to-slate-950/80"
                : "border border-slate-200 bg-white/85 shadow-sm hover:translate-y-[-1px] hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-slate-700"
            }`}
          >
            <CardBody className={`${isMobile ? "p-3" : "p-5"} w-full`}>
              <div
                className={`flex items-start ${isMobile ? "space-x-3" : "space-x-4"} w-full`}
              >
                <div className="relative">
                  <Avatar
                    name={
                      message.from.name
                        ? message.from.name.charAt(0).toUpperCase()
                        : message.from.address.charAt(0).toUpperCase()
                    }
                    className={`flex-shrink-0 font-semibold ${
                      !message.seen
                        ? "bg-sky-500 text-white shadow-lg"
                        : "bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                    }`}
                    size={isMobile ? "md" : "lg"}
                  />
                  {!message.seen && (
                    <div
                      className={`absolute -top-1 -right-1 ${isMobile ? "w-2.5 h-2.5" : "w-3 h-3"} rounded-full border-2 border-white bg-sky-500 dark:border-slate-950`}
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={`flex items-start justify-between ${isMobile ? "mb-1" : "mb-2"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <h3
                        className={`${isMobile ? "text-sm" : "text-base"} truncate ${
                          !message.seen
                            ? "font-bold text-slate-900 dark:text-white"
                            : "font-semibold text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {message.from.name || message.from.address}
                      </h3>
                      {message.from.name &&
                        message.from.address &&
                        message.from.address !== message.from.name && (
                          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {message.from.address}
                          </p>
                        )}
                      <p
                        className={`${isMobile ? "text-xs" : "text-sm"} truncate ${isMobile ? "mt-0.5" : "mt-1"} ${
                          !message.seen
                            ? "font-semibold text-slate-800 dark:text-slate-200"
                            : "font-medium text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        {message.subject}
                      </p>
                    </div>

                    <div
                      className={`ml-3 flex flex-col items-end ${isMobile ? "gap-1" : "gap-1.5"}`}
                    >
                      <span
                        className={`${isMobile ? "text-xs" : "text-xs"} flex-shrink-0 ${
                          !message.seen
                            ? "font-medium text-sky-600 dark:text-sky-300"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {formatDistanceToNow(new Date(message.createdAt), {
                          addSuffix: true,
                          locale: activityLocale,
                        })}
                      </span>
                      {!message.seen && (
                        <div className="rounded-full bg-sky-500 px-2 py-0.5 text-xs font-medium text-white">
                          {t("new")}
                        </div>
                      )}
                    </div>
                  </div>

                  <p
                    className={`${isMobile ? "mt-2 text-xs" : "mt-3 text-sm"} line-clamp-2 leading-relaxed ${
                      !message.seen
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
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-900">
                      {formatMessageSize(message.size)}
                    </span>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
