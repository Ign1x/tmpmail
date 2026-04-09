"use client"

import { useState } from "react"
import { Button } from "@heroui/button"
import { useTranslations } from "next-intl"
import {
  ArrowRight,
  Check,
  Copy,
  Globe2,
  Layers3,
  Mail,
  ServerCog,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { useBranding } from "@/contexts/branding-context"
import { useHeroUIToast } from "@/hooks/use-heroui-toast"
import { copyTextToClipboard } from "@/lib/clipboard"
import FeatureCards from "@/components/feature-cards"

interface EmptyStateProps {
  onCreateAccount: () => void
  isAuthenticated: boolean
  isCreating?: boolean
  primaryDomain: string | null
  availableDomainCount: number
  isOverviewLoading?: boolean
  serviceStatus: "ready" | "degraded" | "offline"
  storeBackend?: string | null
}

export default function EmptyState({
  onCreateAccount,
  isAuthenticated,
  isCreating = false,
  primaryDomain,
  availableDomainCount,
  isOverviewLoading = false,
  serviceStatus,
  storeBackend,
}: EmptyStateProps) {
  const t = useTranslations("emptyState")
  const { toast } = useHeroUIToast()
  const { brandName } = useBranding()
  const hasAvailableDomain = Boolean(primaryDomain)
  const [previewSeed] = useState(() => `start-${Math.random().toString(36).slice(2, 8)}`)
  const [previewCopied, setPreviewCopied] = useState(false)
  const previewAddress = primaryDomain ? `${previewSeed}@${primaryDomain}` : null

  const statusLabel =
    serviceStatus === "ready"
      ? t("serviceReady")
      : serviceStatus === "degraded"
        ? t("serviceDegraded")
        : t("serviceOffline")

  const statusTone =
    serviceStatus === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-200"
      : serviceStatus === "degraded"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200"
        : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-200"

  const steps = [
    {
      number: "01",
      title: t("stepCreateTitle"),
      description: t("stepCreateDescription"),
    },
    {
      number: "02",
      title: t("stepReceiveTitle"),
      description: t("stepReceiveDescription"),
    },
    {
      number: "03",
      title: t("stepResetTitle"),
      description: t("stepResetDescription"),
    },
  ]

  const handleCopyPreview = async () => {
    if (!previewAddress) {
      return
    }

    try {
      await copyTextToClipboard(previewAddress)
      setPreviewCopied(true)
      toast({
        title: t("previewCopied"),
        description: previewAddress,
        color: "success",
        variant: "flat",
      })
      window.setTimeout(() => setPreviewCopied(false), 1800)
    } catch (error) {
      console.error("Failed to copy preview address:", error)
    }
  }

  return (
    <div className="relative overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_58%)] dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_58%)]" />
      <div className="relative mx-auto max-w-5xl">
        <section className="tm-glass-panel-strong overflow-hidden rounded-[2.2rem] p-6 sm:p-8 md:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:gap-10">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
                <Sparkles size={14} />
                {brandName}
              </div>

              <div className="mt-6 max-w-2xl">
                <h2 className="text-balance text-3xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-5xl">
                  {t("title")}
                </h2>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <span className={`tm-chip ${statusTone}`}>
                  <ServerCog size={13} />
                  {statusLabel}
                </span>
                {storeBackend && (
                  <span className="tm-chip">
                    <Layers3 size={13} />
                    {t("backendLabel", { backend: storeBackend })}
                  </span>
                )}
                <span className="tm-chip">
                  <ShieldCheck size={13} />
                  {t("noRisk")}
                </span>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="tm-stat-card min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    <Globe2 size={14} />
                    {t("defaultDomainLabel")}
                  </div>
                  <div className="mt-3 break-all font-mono text-sm leading-6 text-slate-900 dark:text-slate-100">
                    {primaryDomain || t("notConfigured")}
                  </div>
                </div>

                <div className="tm-stat-card min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    <Layers3 size={14} />
                    {t("domainPoolLabel")}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isOverviewLoading ? t("statusLoading") : t("domainPoolValue", { count: availableDomainCount })}
                  </div>
                </div>

                <div className="tm-stat-card min-w-0">
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
                    isDisabled={isCreating || !hasAvailableDomain}
                    endContent={!isCreating && hasAvailableDomain ? <ArrowRight size={18} /> : undefined}
                  >
                    {isCreating ? t("creating") : hasAvailableDomain ? t("useNow") : t("waitingForDomain")}
                  </Button>
                )}

                {previewAddress && (
                  <Button
                    variant="flat"
                    className="h-12 rounded-full border border-slate-200/80 bg-white/82 px-6 text-slate-700 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/82 dark:text-slate-200"
                    onPress={() => void handleCopyPreview()}
                    startContent={previewCopied ? <Check size={17} className="text-emerald-500" /> : <Copy size={16} />}
                  >
                    {previewCopied ? t("previewCopied") : t("copyPreview")}
                  </Button>
                )}
              </div>

              {!hasAvailableDomain && !isOverviewLoading && (
                <p className="mt-4 text-sm leading-7 text-amber-700 dark:text-amber-300">
                  {t("domainSetupHint")}
                </p>
              )}

              <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                {t("ctaHint")}
              </p>
            </div>

            <div className="min-w-0 space-y-4">
              <div className="tm-glass-panel overflow-hidden rounded-[1.9rem] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="tm-section-label">{t("previewLabel")}</div>
                    <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                      {previewAddress ? previewAddress : t("previewUnavailable")}
                    </h3>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
                    <Mail size={22} />
                  </div>
                </div>

                <div className="mt-4 rounded-[1.4rem] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        {t("flowTitle")}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                        {t("flowDescription")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {steps.map((step) => (
                      <div
                        key={step.number}
                        className="rounded-[1.1rem] border border-white/80 bg-white/85 p-4 dark:border-slate-800 dark:bg-slate-950/65"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                            {step.number}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {step.title}
                            </h4>
                            <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                              {step.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="tm-chip">
                    <ShieldCheck size={13} />
                    {t("credentialHint")}
                  </span>
                  <span className="tm-chip">
                    <Globe2 size={13} />
                    {hasAvailableDomain ? primaryDomain : t("previewHint")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <FeatureCards />
      </div>
    </div>
  )
}
