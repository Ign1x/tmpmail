"use client"

import { useState, useEffect } from "react"
import { Spinner } from "@heroui/spinner"
import { TM_SELECT_CLASSNAMES } from "@/components/heroui-field-styles"
import { Select, SelectItem } from "@/components/tm-form-fields"

import type { Domain } from "@/types"
import { useTranslations } from "next-intl"
import { fetchDomainsFromProvider } from "@/lib/api"
import { DEFAULT_PROVIDER_ID } from "@/lib/provider-config"
import { removeStoredValue, writeStoredJson } from "@/lib/storage"

interface DomainSelectorProps {
  value: string
  onSelectionChange: (domain: string) => void
  isDisabled?: boolean
}

export function DomainSelector({ value, onSelectionChange, isDisabled }: DomainSelectorProps) {
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations("domainSelector")

  useEffect(() => {
    let active = true

    const loadDomains = async () => {
      try {
        setLoading(true)
        setError(null)
        setDomains([])

        const nextDomains = await fetchDomainsFromProvider(DEFAULT_PROVIDER_ID)

        if (nextDomains.length === 0) {
          if (!active) {
            return
          }
          setError(t("noDomainsConfigured"))
          removeStoredValue("cached-domains")
          setLoading(false)
          return
        }

        if (!active) {
          return
        }

        setDomains(nextDomains)
        writeStoredJson("cached-domains", nextDomains)
        setLoading(false)
      } catch (err) {
        if (!active) {
          return
        }
        console.error("Failed to load domains:", err)
        setDomains([])
        setError(t("fetchFailed"))
        setLoading(false)
      }
    }

    void loadDomains()

    return () => {
      active = false
    }
  }, [t])

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

  return (
    <Select
      label={t("selectDomain")}
      placeholder={t("chooseDomain")}
      selectedKeys={value ? [value] : []}
      onSelectionChange={(keys) => {
        const selectedKey = Array.from(keys)[0] as string
        if (selectedKey) {
          onSelectionChange(selectedKey)
        }
      }}
      isDisabled={isDisabled}
      variant="bordered"
      className="w-full"
      classNames={{
        ...TM_SELECT_CLASSNAMES,
        listbox: "p-0",
        popoverContent: `${TM_SELECT_CLASSNAMES.popoverContent} p-1`,
      }}
    >
      {domains.map((domain) => (
        <SelectItem
          key={domain.domain}
          textValue={domain.domain}
          className="mx-1 rounded-md"
          classNames={{ base: "hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors", wrapper: "px-3 py-2" }}
        >
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            <span className="font-mono text-sm text-gray-800 dark:text-gray-200">{domain.domain}</span>
          </div>
        </SelectItem>
      ))}
    </Select>
  )
}
