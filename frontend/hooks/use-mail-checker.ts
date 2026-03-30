"use client"

import { useEffect, useRef, useCallback } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useMailStatus } from "@/contexts/mail-status-context"
import { createProviderHeaders, getMessages } from "@/lib/api"
import type { Message } from "@/types"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"

interface UseMailCheckerOptions {
  currentMessages?: Message[]
  onNewMessage?: (message: Message) => void
  onMessagesUpdate?: (messages: Message[]) => void
  enabled?: boolean // 是否启用自动检查
}

export function useMailChecker({
  currentMessages = [],
  onNewMessage,
  onMessagesUpdate,
  enabled = true,
}: UseMailCheckerOptions = {}) {
  const { token, currentAccount, isAuthenticated } = useAuth()
  const { setConnectionState, setLastCheckTime, setNewMessageCount } = useMailStatus()
  const reconnectRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const connectRef = useRef<(() => Promise<void>) | null>(null)
  const lastMessagesRef = useRef<Message[]>([])
  const isRefreshingRef = useRef(false)
  const reconnectAttemptsRef = useRef(0)
  const shouldReconnectRef = useRef(false)

  const onNewMessageRef = useRef(onNewMessage)
  const onMessagesUpdateRef = useRef(onMessagesUpdate)

  useEffect(() => {
    onNewMessageRef.current = onNewMessage
    onMessagesUpdateRef.current = onMessagesUpdate
  }, [onNewMessage, onMessagesUpdate])

  useEffect(() => {
    lastMessagesRef.current = currentMessages
  }, [currentMessages])

  const refreshMessages = useCallback(async () => {
    if (!token || !currentAccount || !isAuthenticated || isRefreshingRef.current) {
      return
    }

    isRefreshingRef.current = true

    try {
      const providerId = currentAccount.providerId || DEFAULT_PROVIDER_ID
      const { messages } = await getMessages(token, 1, providerId)
      const nextMessages = messages || []
      const previousMessages = lastMessagesRef.current
      const newMessages = nextMessages.filter(
        (message) => !previousMessages.some((current) => current.id === message.id),
      )

      if (newMessages.length > 0) {
        setNewMessageCount(newMessages.length)
        newMessages.forEach((message) => {
          onNewMessageRef.current?.(message)
        })
      } else {
        setNewMessageCount(0)
      }

      onMessagesUpdateRef.current?.(nextMessages)
      lastMessagesRef.current = nextMessages
      setLastCheckTime(new Date())
    } catch (error) {
      console.error("❌ [MailChecker] Failed to refresh mailbox from stream:", error)
    } finally {
      isRefreshingRef.current = false
    }
  }, [
    currentAccount,
    isAuthenticated,
    setLastCheckTime,
    setNewMessageCount,
    token,
  ])

  const stopChecking = useCallback(() => {
    shouldReconnectRef.current = false

    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
      reconnectRef.current = null
    }

    abortRef.current?.abort()
    abortRef.current = null
    reconnectAttemptsRef.current = 0
    setConnectionState("idle")
  }, [setConnectionState])

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) {
      return
    }

    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
    }

    reconnectAttemptsRef.current += 1
    const delay = Math.min(1000 * 2 ** (reconnectAttemptsRef.current - 1), 10000)
    setConnectionState("reconnecting")

    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null
      void connectRef.current?.()
    }, delay)
  }, [setConnectionState])

  const handleEvent = useCallback(
    async (eventName: string, rawData: string) => {
      if (eventName === "connected" || eventName === "heartbeat" || eventName === "lagged") {
        setLastCheckTime(new Date())
        return
      }

      if (eventName.startsWith("message.")) {
        await refreshMessages()
        return
      }

      if (rawData) {
        try {
          const parsed = JSON.parse(rawData)
          if (typeof parsed?.event === "string" && parsed.event.startsWith("message.")) {
            await refreshMessages()
          }
        } catch {}
      }
    },
    [refreshMessages, setLastCheckTime],
  )

  const connectStream = useCallback(async () => {
    if (!enabled || !token || !currentAccount || !isAuthenticated) {
      stopChecking()
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setConnectionState(
      reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting",
    )

    try {
      const providerId = currentAccount.providerId || DEFAULT_PROVIDER_ID
      const response = await fetch(
        `/api/sse?accountId=${encodeURIComponent(currentAccount.id)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            ...createProviderHeaders(providerId),
          },
          cache: "no-store",
          signal: controller.signal,
        },
      )

      if (!response.ok || !response.body) {
        throw new Error(`stream request failed with status ${response.status}`)
      }

      reconnectAttemptsRef.current = 0
      setConnectionState("connected")
      setLastCheckTime(new Date())

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })

        let separatorIndex = buffer.indexOf("\n\n")
        while (separatorIndex >= 0) {
          const rawEvent = buffer.slice(0, separatorIndex)
          buffer = buffer.slice(separatorIndex + 2)

          const lines = rawEvent
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
          const eventName =
            lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ||
            "message"
          const data = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n")

          await handleEvent(eventName, data)
          separatorIndex = buffer.indexOf("\n\n")
        }
      }

      if (!controller.signal.aborted) {
        throw new Error("stream closed unexpectedly")
      }
    } catch (error) {
      if (controller.signal.aborted || !shouldReconnectRef.current) {
        return
      }

      console.error("❌ [MailChecker] Mail stream disconnected:", error)
      setConnectionState("error")
      scheduleReconnect()
    }
  }, [
    currentAccount,
    enabled,
    handleEvent,
    isAuthenticated,
    scheduleReconnect,
    setConnectionState,
    setLastCheckTime,
    stopChecking,
    token,
  ])

  useEffect(() => {
    connectRef.current = connectStream
  }, [connectStream])

  const startChecking = useCallback(() => {
    shouldReconnectRef.current = true
    void connectStream()
  }, [connectStream])

  useEffect(() => {
    if (!enabled || !token || !currentAccount || !isAuthenticated) {
      stopChecking()
      return
    }

    shouldReconnectRef.current = true
    void connectStream()

    return () => {
      stopChecking()
    }
  }, [connectStream, currentAccount, enabled, isAuthenticated, stopChecking, token])

  return {
    startChecking,
    stopChecking,
    isChecking: abortRef.current !== null,
  }
}
