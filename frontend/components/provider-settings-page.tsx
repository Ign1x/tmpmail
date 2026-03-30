"use client"

import { useState } from "react"
import { Button } from "@heroui/button"
import { Card, CardBody, CardHeader } from "@heroui/card"
import { Divider } from "@heroui/divider"
import { Input } from "@heroui/input"
import { Edit3, Plus, Server, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { useApiProvider } from "@/contexts/api-provider-context"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import type { CustomApiProvider } from "@/types"

export default function ProviderSettingsPage() {
  const {
    providers,
    addCustomProvider,
    removeCustomProvider,
    updateCustomProvider,
    toggleProviderEnabled,
    isProviderEnabled,
  } = useApiProvider()
  const { toast } = useHeroUIToast()
  const t = useTranslations("settings")
  const tc = useTranslations("common")

  const [showCustomForm, setShowCustomForm] = useState(false)
  const [editingProvider, setEditingProvider] = useState<CustomApiProvider | null>(null)
  const [customForm, setCustomForm] = useState({
    id: "",
    name: "",
    baseUrl: "",
  })

  const resetCustomForm = () => {
    setCustomForm({ id: "", name: "", baseUrl: "" })
    setEditingProvider(null)
  }

  const handleAddCustomProvider = () => {
    if (!customForm.id || !customForm.name || !customForm.baseUrl) {
      toast({ title: t("fillAllFields"), color: "danger", variant: "flat" })
      return
    }

    if (providers.some((provider) => provider.id === customForm.id) && !editingProvider) {
      toast({
        title: t("idExists"),
        description: t("idExistsDesc"),
        color: "danger",
        variant: "flat",
      })
      return
    }

    const nextProvider: CustomApiProvider = { ...customForm, isCustom: true }

    if (editingProvider) {
      updateCustomProvider(nextProvider)
      toast({ title: t("providerUpdated"), color: "success", variant: "flat" })
    } else {
      addCustomProvider(nextProvider)
      toast({ title: t("providerAdded"), color: "success", variant: "flat" })
    }

    setShowCustomForm(false)
    resetCustomForm()
  }

  const handleEditProvider = (provider: CustomApiProvider) => {
    setCustomForm({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
    })
    setEditingProvider(provider)
    setShowCustomForm(true)
  }

  const handleDeleteProvider = (providerId: string) => {
    removeCustomProvider(providerId)
    toast({ title: t("providerDeleted"), color: "warning", variant: "flat" })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <section className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
          <Server size={14} />
          {t("title")}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          {t("providerManagement")}
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
          {t("settingsPageDescription")}
        </p>
      </section>

      <section className="space-y-3">
        {providers.map((provider) => (
          <Card
            key={provider.id}
            className={`border ${
              isProviderEnabled(provider.id)
                ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/20"
                : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/60"
            }`}
          >
            <CardBody className="p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-1 h-3 w-3 rounded-full ${
                      isProviderEnabled(provider.id) ? "bg-emerald-500" : "bg-gray-400"
                    }`}
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{provider.name}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{provider.baseUrl}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {isProviderEnabled(provider.id) ? t("enabled") : t("disabled")}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {provider.isCustom && (
                    <>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        onPress={() => handleEditProvider(provider as CustomApiProvider)}
                      >
                        <Edit3 size={16} />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="danger"
                        onPress={() => handleDeleteProvider(provider.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant={isProviderEnabled(provider.id) ? "flat" : "solid"}
                    color={isProviderEnabled(provider.id) ? "warning" : "success"}
                    onPress={() => toggleProviderEnabled(provider.id)}
                  >
                    {isProviderEnabled(provider.id) ? t("disable") : t("enable")}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </section>

      <Divider />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("customProvider")}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {t("customProviderDescription")}
            </p>
          </div>
          <Button
            size="sm"
            color="primary"
            variant="flat"
            startContent={<Plus size={16} />}
            onPress={() => {
              resetCustomForm()
              setShowCustomForm(true)
            }}
          >
            {t("add")}
          </Button>
        </div>

        {showCustomForm && (
          <Card>
            <CardHeader>
              <h3 className="text-md font-medium">
                {editingProvider ? t("editProvider") : t("addCustomProvider")}
              </h3>
            </CardHeader>
            <CardBody className="space-y-4">
              <Input
                label={t("idLabel")}
                placeholder={t("idPlaceholder")}
                value={customForm.id}
                onValueChange={(value) => setCustomForm((currentForm) => ({ ...currentForm, id: value }))}
                isDisabled={!!editingProvider}
              />
              <Input
                label={t("nameLabel")}
                placeholder={t("namePlaceholder")}
                value={customForm.name}
                onValueChange={(value) => setCustomForm((currentForm) => ({ ...currentForm, name: value }))}
              />
              <Input
                label={t("baseUrlLabel")}
                placeholder="https://api.example.com"
                value={customForm.baseUrl}
                onValueChange={(value) =>
                  setCustomForm((currentForm) => ({ ...currentForm, baseUrl: value }))
                }
              />
              <div className="flex gap-2">
                <Button color="primary" onPress={handleAddCustomProvider}>
                  {editingProvider ? t("update") : t("add")}
                </Button>
                <Button
                  variant="light"
                  onPress={() => {
                    setShowCustomForm(false)
                    resetCustomForm()
                  }}
                >
                  {tc("cancel")}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </section>
    </div>
  )
}
