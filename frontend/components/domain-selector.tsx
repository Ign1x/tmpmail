"use client"

import { useState, useEffect } from "react"
import { Select, SelectItem } from "@heroui/select"
import { Spinner } from "@heroui/spinner"

import type { Domain } from "@/types"
import { useTranslations } from "next-intl"
import { useApiProvider } from "@/contexts/api-provider-context"
import {
  DEFAULT_PROVIDER_ID,
  getProviderAccentClass,
} from "@/lib/provider-config"

interface DomainSelectorProps {
  value: string
  onSelectionChange: (domain: string) => void
  isDisabled?: boolean
}

export function DomainSelector({ value, onSelectionChange, isDisabled }: DomainSelectorProps) {
  const { enabledProviders } = useApiProvider()
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations("domainSelector")

  useEffect(() => {
    const loadDomains = async () => {
      try {
        setLoading(true)
        setError(null)
        setDomains([])

        if (enabledProviders.length === 0) {
          setError(t("noProviders"))
          setLoading(false)
          localStorage.removeItem("cached-domains")
          return
        }

        const domainResults = await Promise.all(
          enabledProviders.map(async (provider) => {
            const { fetchDomainsFromProvider } = await import("@/lib/api")
            const providerDomains = await fetchDomainsFromProvider(provider.id)
            return providerDomains.map((domain) => ({
              ...domain,
              providerId: provider.id,
              providerName: provider.name,
            }))
          }),
        )

        const mergedDomains: Domain[] = []
        const existingKeys = new Set<string>()

        domainResults.flat().forEach((domain) => {
          const key = `${domain.providerId || DEFAULT_PROVIDER_ID}:${domain.domain}`
          if (existingKeys.has(key)) {
            return
          }

          existingKeys.add(key)
          mergedDomains.push(domain)
        })

        if (mergedDomains.length === 0) {
          setError(t("allFailed"))
          localStorage.removeItem("cached-domains")
          setLoading(false)
          return
        }

        setDomains(mergedDomains)
        localStorage.setItem("cached-domains", JSON.stringify(mergedDomains))
        setLoading(false)
      } catch (err) {
        console.error("Failed to load domains:", err)
        setDomains([])
        setError(t("fetchFailed"))
        setLoading(false)
      }
    }

    void loadDomains()
  }, [enabledProviders, t])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner size="sm" />
        <span className="ml-2 text-sm text-gray-600">{t("loading")}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-500 text-sm">{error}</div>
    )
  }

  const domainsByProvider = domains.reduce((acc, domain) => {
    const providerId = domain.providerId || DEFAULT_PROVIDER_ID
    if (!acc[providerId]) {
      acc[providerId] = { providerName: domain.providerName || providerId, domains: [] }
    }
    acc[providerId].domains.push(domain)
    return acc
  }, {} as Record<string, { providerName: string; domains: Domain[] }>)

  return (
    <Select
      label={t("selectDomain")}
      placeholder={t("chooseDomain")}
      selectedKeys={value ? (() => {
        const matchingKey = Object.entries(domainsByProvider).flatMap(([providerId, { domains }]) =>
          domains.map(domain => `${providerId}-${domain.domain}`)
        ).find(key => key.endsWith(`-${value}`))
        return matchingKey ? [matchingKey] : []
      })() : []}
      onSelectionChange={(keys) => {
        const selectedKey = Array.from(keys)[0] as string
        if (selectedKey) {
          const domain = selectedKey.includes('-') ? selectedKey.split('-').slice(1).join('-') : selectedKey
          onSelectionChange(domain)
        }
      }}
      isDisabled={isDisabled}
      className="w-full"
      classNames={{ listbox: "p-0", popoverContent: "p-1" }}
    >
      {Object.entries(domainsByProvider).flatMap(([providerId, { providerName, domains: providerDomains }]) => [
        <SelectItem
          key={`header-${providerId}`}
          textValue={`${providerName}`}
          className="opacity-100 cursor-default pointer-events-none"
          classNames={{ base: "bg-gray-50 dark:bg-gray-800 rounded-md mx-1 my-1", wrapper: "px-3 py-2" }}
          isReadOnly
        >
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${getProviderAccentClass(providerId)}`} />
            <span className="font-medium text-gray-700 dark:text-gray-300 text-sm">{providerName}</span>
          </div>
        </SelectItem>,
        ...providerDomains.map((domain) => (
          <SelectItem
            key={`${providerId}-${domain.domain}`}
            textValue={domain.domain}
            className="mx-1 rounded-md"
            classNames={{ base: "hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors", wrapper: "px-3 py-2" }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full ${getProviderAccentClass(providerId, "soft")}`} />
                <span className="text-gray-800 dark:text-gray-200 font-mono text-sm">{domain.domain}</span>
              </div>
              <div className="flex items-center gap-1" />
            </div>
          </SelectItem>
        ))
      ])}
    </Select>
  )
}
