"use client"

import { useState, useTransition } from "react"
import { Button } from "@heroui/button"
import { ArrowLeft, Check, ExternalLink, Languages, Link2 } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { usePathname, useRouter } from "@/i18n/navigation"
import { useBranding } from "@/contexts/branding-context"
import { DEFAULT_PROVIDER_BASE_URL } from "@/lib/provider-config"
import { replaceBrandNameText } from "@/lib/site-branding"
import { cn } from "@/lib/utils"

type ApiAuthType =
  | "none"
  | "required-token"
  | "required-apikey"
  | "optional-apikey"

type ApiMethod = "GET" | "POST" | "DELETE"

interface ApiEndpoint {
  method: ApiMethod
  path: string
  description: string
  authType: ApiAuthType
}

interface ApiEndpointGroup {
  group: string
  endpoints: ApiEndpoint[]
}

function authLabel(authType: ApiAuthType, t: (key: string) => string): string {
  switch (authType) {
    case "required-token":
      return t("bearerToken")
    case "required-apikey":
      return t("apiKey")
    case "optional-apikey":
      return `${t("apiKey")} (${t("optional")})`
    default:
      return t("none")
  }
}

function InfoBlock({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-100">
        {title}
      </h2>
      <div className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
        {children}
      </div>
    </section>
  )
}

function EndpointTable({
  group,
  endpoints,
  t,
}: {
  group: string
  endpoints: ApiEndpoint[]
  t: (key: string) => string
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="text-base font-semibold text-slate-950 dark:text-white">
          {group}
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/60">
            <tr className="text-left text-slate-500 dark:text-slate-400">
              <th className="px-4 py-3 font-medium">{t("methodTitle")}</th>
              <th className="px-4 py-3 font-medium">{t("path")}</th>
              <th className="px-4 py-3 font-medium">{t("authorization")}</th>
              <th className="px-4 py-3 font-medium">{t("descriptionTitle")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {endpoints.map((endpoint) => (
              <tr key={`${group}-${endpoint.method}-${endpoint.path}`}>
                <td className="px-4 py-4 align-top">
                  <span className="inline-flex h-8 min-w-[72px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold tracking-[0.14em] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    {endpoint.method}
                  </span>
                </td>
                <td className="px-4 py-4 align-top">
                  <code className="api-docs-mono text-[13px] text-slate-900 dark:text-slate-100">
                    {endpoint.path}
                  </code>
                </td>
                <td className="px-4 py-4 align-top text-slate-700 dark:text-slate-300">
                  {authLabel(endpoint.authType, t)}
                </td>
                <td className="px-4 py-4 align-top text-slate-700 dark:text-slate-300">
                  {endpoint.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function ApiDocsPage() {
  const navRouter = useRouter()
  const pathname = usePathname()
  const locale = useLocale()
  const t = useTranslations("apiDocs")
  const { brandName } = useBranding()
  const [copySuccess, setCopySuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const llmDocsPath = "/llm-api-docs.txt"

  const apiEndpoints: ApiEndpointGroup[] = [
    {
      group: t("domainGroup"),
      endpoints: [
        {
          method: "GET",
          path: "/domains",
          description: t("domainGetDesc"),
          authType: "optional-apikey",
        },
        {
          method: "POST",
          path: "/domains",
          description: t("domainCreateDesc"),
          authType: "required-apikey",
        },
        {
          method: "GET",
          path: "/domains/{id}/records",
          description: t("domainRecordsDesc"),
          authType: "required-apikey",
        },
        {
          method: "POST",
          path: "/domains/{id}/verify",
          description: t("domainVerifyDesc"),
          authType: "required-apikey",
        },
      ],
    },
    {
      group: t("accountGroup"),
      endpoints: [
        {
          method: "POST",
          path: "/accounts",
          description: t("accountCreateDesc"),
          authType: "none",
        },
        {
          method: "GET",
          path: "/me",
          description: t("accountMeDesc"),
          authType: "required-token",
        },
        {
          method: "DELETE",
          path: "/accounts/{id}",
          description: t("accountDeleteDesc"),
          authType: "required-token",
        },
      ],
    },
    {
      group: t("authGroup"),
      endpoints: [
        {
          method: "POST",
          path: "/token",
          description: t("tokenDesc"),
          authType: "none",
        },
      ],
    },
    {
      group: t("messageGroup"),
      endpoints: [
        {
          method: "GET",
          path: "/messages",
          description: t("messageListDesc"),
          authType: "required-token",
        },
        {
          method: "GET",
          path: "/messages/{id}",
          description: t("messageGetDesc"),
          authType: "required-token",
        },
        {
          method: "DELETE",
          path: "/messages/{id}",
          description: t("messageDeleteDesc"),
          authType: "required-token",
        },
      ],
    },
  ]

  const toggleLocale = () => {
    const newLocale = locale === "en" ? "zh" : "en"
    startTransition(() => {
      navRouter.replace(pathname, { locale: newLocale })
    })
  }

  const copyLlmDocsLink = async () => {
    try {
      const value =
        typeof window === "undefined"
          ? llmDocsPath
          : new URL(llmDocsPath, window.location.origin).toString()

      await navigator.clipboard.writeText(value)
      setCopySuccess(true)
      window.setTimeout(() => setCopySuccess(false), 2000)
    } catch {}
  }

  return (
    <div
      className={cn(
        "min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100",
        isPending && "pointer-events-none opacity-60",
      )}
    >
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Button
            className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            startContent={<ArrowLeft size={16} />}
            variant="flat"
            onPress={() => navRouter.push("/")}
          >
            {t("back")}
          </Button>
          <Button
            className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            startContent={<Languages size={16} />}
            variant="flat"
            onPress={toggleLocale}
          >
            {t("language")}
          </Button>
        </div>

        <article className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <header className="border-b border-slate-200 px-6 py-8 dark:border-slate-800 md:px-8">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {t("title")}
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {replaceBrandNameText(t("subtitle"), brandName)}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              {replaceBrandNameText(t("description"), brandName)}
            </p>
          </header>

          <div className="space-y-6 px-6 py-8 md:px-8">
            <section className="grid gap-4 md:grid-cols-3">
              <InfoBlock title={t("baseUrl")}>
                <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
                  <code className="api-docs-mono break-all text-[13px] text-slate-900 dark:text-slate-100">
                    {DEFAULT_PROVIDER_BASE_URL}
                  </code>
                </div>
              </InfoBlock>

              <InfoBlock title={t("auth")}>
                <p>{t("authDescription")}</p>
                <p className="mt-3">{t("apiKeyDescription")}</p>
              </InfoBlock>

              <InfoBlock title={t("llmDocs")}>
                <p>{t("llmDocsDescription")}</p>
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
                  <code className="api-docs-mono break-all text-[13px] text-slate-900 dark:text-slate-100">
                    {llmDocsPath}
                  </code>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    as="a"
                    className="h-10 rounded-lg bg-slate-900 px-4 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200"
                    href={llmDocsPath}
                    rel="noopener noreferrer"
                    startContent={<ExternalLink size={16} />}
                    target="_blank"
                  >
                    {t("openLink")}
                  </Button>
                  <Button
                    className="h-10 rounded-lg border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    startContent={copySuccess ? <Check size={16} /> : <Link2 size={16} />}
                    variant="bordered"
                    onPress={copyLlmDocsLink}
                  >
                    {copySuccess ? t("copySuccess") : t("copyLink")}
                  </Button>
                </div>
              </InfoBlock>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                {t("endpoints")}
              </h2>
              <div className="mt-4 space-y-4">
                {apiEndpoints.map((group) => (
                  <EndpointTable
                    key={group.group}
                    endpoints={group.endpoints}
                    group={group.group}
                    t={t}
                  />
                ))}
              </div>
            </section>
          </div>
        </article>
      </div>
    </div>
  )
}
