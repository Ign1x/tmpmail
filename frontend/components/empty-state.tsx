"use client"

import { Button } from "@heroui/button"
import { useTranslations } from "next-intl"
import { ArrowRight, Globe2, Layers3, ServerCog, ShieldCheck, Sparkles } from "lucide-react"
import { BRAND_NAME } from "@/lib/provider-config"
import type { ServiceStatusResponse } from "@/lib/api"

interface EmptyStateProps {
  onCreateAccount: () => void
  isAuthenticated: boolean
  isCreating?: boolean
  primaryDomain: string
  availableDomainCount: number
  domainPreview: string[]
  serviceStatus: ServiceStatusResponse | null
  isOverviewLoading?: boolean
}

function getServiceTone(status: ServiceStatusResponse | null) {
  switch (status?.status) {
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
    case "degraded":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
    default:
      return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300"
  }
}

function formatBackendLabel(storeBackend?: string): string {
  if (!storeBackend) {
    return "N/A"
  }

  return storeBackend.charAt(0).toUpperCase() + storeBackend.slice(1)
}

export default function EmptyState({
  onCreateAccount,
  isAuthenticated,
  isCreating = false,
  primaryDomain,
  availableDomainCount,
  domainPreview,
  serviceStatus,
  isOverviewLoading = false,
}: EmptyStateProps) {
  const t = useTranslations("emptyState")
  const serviceTone = getServiceTone(serviceStatus)
  const readyAddress = `quick-start@${primaryDomain}`
  const serviceLabel =
    serviceStatus?.status === "ready"
      ? t("serviceReady")
      : serviceStatus?.status === "degraded"
        ? t("serviceDegraded")
        : t("serviceOffline")

  return (
    <div className="relative overflow-hidden px-4 py-10 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_58%)] dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_58%)]" />
      <div className="relative mx-auto max-w-5xl">
        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/70 dark:shadow-none sm:p-8 md:p-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
              <Sparkles size={14} />
              {BRAND_NAME}
            </div>

            <div className="flex flex-wrap gap-2">
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${serviceTone}`}>
                <ShieldCheck size={14} />
                {serviceLabel}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-300">
                <ServerCog size={14} />
                {t("backendLabel", { backend: formatBackendLabel(serviceStatus?.storeBackend) })}
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
            <div className="min-w-0">
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-5xl">
                {t("title")}
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300 md:text-base">
                {t("description")}
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    <Globe2 size={14} />
                    {t("defaultDomainLabel")}
                  </div>
                  <div className="mt-3 break-all font-mono text-sm leading-6 text-slate-900 dark:text-slate-100">
                    {primaryDomain}
                  </div>
                </div>

                <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    <Layers3 size={14} />
                    {t("domainPoolLabel")}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isOverviewLoading
                      ? t("statusLoading")
                      : t("domainPoolValue", { count: availableDomainCount })}
                  </div>
                </div>

                <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    <ShieldCheck size={14} />
                    {t("privacyLabel")}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t("credentialHint")}
                  </div>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                {!isAuthenticated && (
                  <Button
                    color="primary"
                    size="lg"
                    className="h-12 rounded-full bg-sky-600 px-7 text-base font-semibold text-white shadow-lg shadow-sky-500/20 hover:bg-sky-700"
                    onPress={onCreateAccount}
                    isLoading={isCreating}
                    isDisabled={isCreating}
                    endContent={!isCreating ? <ArrowRight size={18} /> : undefined}
                  >
                    {isCreating ? t("creating") : t("useNow")}
                  </Button>
                )}

                <p className="text-xs leading-6 text-slate-500 dark:text-slate-400">
                  {t("poweredBy")}
                </p>
              </div>
            </div>

            <div className="min-w-0 rounded-[1.75rem] border border-slate-900/90 bg-slate-950 px-5 py-5 text-white shadow-[0_20px_70px_rgba(15,23,42,0.22)] dark:border-slate-700 dark:bg-slate-900">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
                {t("previewLabel")}
              </div>
              <div className="mt-3 break-all font-mono text-lg text-white sm:text-xl">
                {readyAddress}
              </div>
              <div className="mt-3 text-xs text-slate-300">
                {t("credentialHint")}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {(domainPreview.length > 0 ? domainPreview : [primaryDomain]).map((domain) => (
                  <div
                    key={domain}
                    className="max-w-full break-all rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-left text-xs font-medium leading-5 text-slate-100"
                  >
                    {domain}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
