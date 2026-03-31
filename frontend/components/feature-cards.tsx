"use client"

import { Card, CardBody } from "@heroui/card"
import { Shield, Zap, Gauge } from "lucide-react"
import { useTranslations } from "next-intl"

export default function FeatureCards() {
  const t = useTranslations("featureCards")

  const features = [
    {
      icon: Shield,
      titleKey: "secureTitle" as const,
      descKey: "secureDesc" as const,
      accent: "from-sky-100 via-white to-cyan-50 dark:from-sky-950/50 dark:via-slate-950 dark:to-cyan-950/20",
      iconTone: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200",
    },
    {
      icon: Zap,
      titleKey: "instantTitle" as const,
      descKey: "instantDesc" as const,
      accent: "from-amber-100 via-white to-orange-50 dark:from-amber-950/40 dark:via-slate-950 dark:to-orange-950/20",
      iconTone: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
    },
    {
      icon: Gauge,
      titleKey: "fastTitle" as const,
      descKey: "fastDesc" as const,
      accent: "from-emerald-100 via-white to-teal-50 dark:from-emerald-950/40 dark:via-slate-950 dark:to-teal-950/20",
      iconTone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
    },
  ]

  return (
    <div className="mt-auto px-4 pb-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 md:grid-cols-3">
        {features.map((feature, index) => {
          const Icon = feature.icon
          return (
            <Card
              key={index}
              className={`overflow-hidden border border-white/70 bg-gradient-to-br ${feature.accent} shadow-sm backdrop-blur dark:border-slate-800 dark:shadow-none`}
            >
              <CardBody className="flex items-start gap-4 p-5">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm ${feature.iconTone}`}>
                  <Icon size={24} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t(feature.titleKey)}
                  </h3>
                  <p className="mt-1 text-xs leading-6 text-slate-600 dark:text-slate-300">
                    {t(feature.descKey)}
                  </p>
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
