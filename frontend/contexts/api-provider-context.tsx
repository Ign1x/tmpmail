"use client"

import React, { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import type { ApiProvider, CustomApiProvider } from "@/types"
import { PRESET_PROVIDERS, getDefaultDisabledProviderIds } from "@/lib/provider-config"

interface ApiProviderContextType {
  providers: ApiProvider[]
  enabledProviders: ApiProvider[]
  disabledProviderIds: string[]
  addCustomProvider: (provider: CustomApiProvider) => void
  removeCustomProvider: (providerId: string) => void
  updateCustomProvider: (provider: CustomApiProvider) => void
  toggleProviderEnabled: (providerId: string) => void
  isProviderEnabled: (providerId: string) => boolean
  getProviderById: (providerId: string) => ApiProvider | undefined
}

const ApiProviderContext = createContext<ApiProviderContextType | undefined>(undefined)

interface ApiProviderProviderProps {
  children: ReactNode
}

export function ApiProviderProvider({ children }: ApiProviderProviderProps) {
  const [customProviders, setCustomProviders] = useState<CustomApiProvider[]>([])
  const [disabledProviderIds, setDisabledProviderIds] = useState<string[]>(getDefaultDisabledProviderIds())

  // 所有提供商（预设 + 自定义）
  const providers = [...PRESET_PROVIDERS, ...customProviders]

  // 启用的提供商
  const enabledProviders = providers.filter(provider =>
    !disabledProviderIds.includes(provider.id)
  )

  // 从localStorage加载设置
  useEffect(() => {
    try {
      const savedCustomProviders = localStorage.getItem("custom-api-providers")
      const savedDisabledProviders = localStorage.getItem("disabled-api-providers")

      if (savedCustomProviders) {
        const parsed = JSON.parse(savedCustomProviders)
        if (Array.isArray(parsed)) {
          setCustomProviders(parsed)
        }
      }

      if (savedDisabledProviders) {
        const parsed = JSON.parse(savedDisabledProviders)
        if (Array.isArray(parsed)) {
          setDisabledProviderIds(parsed)
        }
      }

      // Clear the legacy account-level key cache. Admin auth now lives on /admin only.
      localStorage.removeItem("api-key")
    } catch (error) {
      console.error("Error loading API provider settings:", error)
    }
  }, [])

  // 添加自定义提供商
  const addCustomProvider = (provider: CustomApiProvider) => {
    const newCustomProviders = [...customProviders, provider]
    setCustomProviders(newCustomProviders)
    localStorage.setItem("custom-api-providers", JSON.stringify(newCustomProviders))
  }

  // 删除自定义提供商
  const removeCustomProvider = (providerId: string) => {
    const newCustomProviders = customProviders.filter(p => p.id !== providerId)
    setCustomProviders(newCustomProviders)
    localStorage.setItem("custom-api-providers", JSON.stringify(newCustomProviders))
  }

  // 更新自定义提供商
  const updateCustomProvider = (provider: CustomApiProvider) => {
    const newCustomProviders = customProviders.map(p =>
      p.id === provider.id ? provider : p
    )
    setCustomProviders(newCustomProviders)
    localStorage.setItem("custom-api-providers", JSON.stringify(newCustomProviders))
  }

  // 切换提供商启用状态
  const toggleProviderEnabled = (providerId: string) => {
    const newDisabledIds = disabledProviderIds.includes(providerId)
      ? disabledProviderIds.filter(id => id !== providerId)
      : [...disabledProviderIds, providerId]

    setDisabledProviderIds(newDisabledIds)
    localStorage.setItem("disabled-api-providers", JSON.stringify(newDisabledIds))
  }

  // 检查提供商是否启用
  const isProviderEnabled = (providerId: string) => {
    return !disabledProviderIds.includes(providerId)
  }

  // 根据ID获取提供商
  const getProviderById = (providerId: string) => {
    return providers.find(p => p.id === providerId)
  }

  const value: ApiProviderContextType = {
    providers,
    enabledProviders,
    disabledProviderIds,
    addCustomProvider,
    removeCustomProvider,
    updateCustomProvider,
    toggleProviderEnabled,
    isProviderEnabled,
    getProviderById,
  }

  return (
    <ApiProviderContext.Provider value={value}>
      {children}
    </ApiProviderContext.Provider>
  )
}

export function useApiProvider() {
  const context = useContext(ApiProviderContext)
  if (context === undefined) {
    throw new Error("useApiProvider must be used within an ApiProviderProvider")
  }
  return context
}
