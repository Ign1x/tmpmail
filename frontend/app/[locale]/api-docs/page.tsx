"use client"

import { useState, useTransition } from "react"
import { Button } from "@heroui/button"
import { Card, CardBody } from "@heroui/card"
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Info,
  KeyRound,
  Languages,
  ReceiptText,
  Server,
} from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { useRouter, usePathname } from "@/i18n/navigation"
import {
  BRAND_NAME,
  BRAND_REPO_URL,
  DEFAULT_DOMAIN,
  DEFAULT_PROVIDER_BASE_URL,
  EXAMPLE_DOMAIN,
} from "@/lib/provider-config"
import { cn } from "@/lib/utils"

type ApiAuthType =
  | "none"
  | "required-token"
  | "required-apikey"
  | "optional-apikey"

type ApiMethod = "GET" | "POST" | "DELETE"

interface ApiPathParam {
  name: string
  value: string
}

interface ApiEndpoint {
  method: ApiMethod
  path: string
  description: string
  authType: ApiAuthType
  body?: string
  pathParams?: ApiPathParam[]
}

interface ApiEndpointGroup {
  group: string
  endpoints: ApiEndpoint[]
}

function methodBadgeClassName(method: ApiMethod): string {
  switch (method) {
    case "GET":
      return "bg-sky-100 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-900/80"
    case "POST":
      return "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900/80"
    case "DELETE":
      return "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900/80"
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800"
  }
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

function ApiEndpointCard({
  endpoint,
  isZh,
  t,
}: {
  endpoint: ApiEndpoint
  isZh: boolean
  t: (key: string) => string
}) {
  const badgeLabelClassName = isZh
    ? "rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium tracking-[0.06em] text-slate-600 dark:bg-slate-900 dark:text-slate-300"
    : "rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-600 dark:bg-slate-900 dark:text-slate-300"

  return (
    <Card className="overflow-hidden border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
      <CardBody className="gap-0 p-0">
        <div className="border-b border-slate-200/80 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start gap-3">
              <span
                className={cn(
                  "inline-flex min-w-[72px] justify-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ring-1",
                  methodBadgeClassName(endpoint.method),
                )}
              >
                {endpoint.method}
              </span>
              <div className="min-w-0 flex-1 overflow-x-auto">
                <code className="api-docs-mono inline-flex min-w-fit rounded-2xl bg-slate-950 px-4 py-3 text-[13px] text-slate-100 shadow-inner dark:bg-black">
                  {endpoint.path}
                </code>
              </div>
              <span className={badgeLabelClassName}>
                {t("authorization")}: {authLabel(endpoint.authType, t)}
              </span>
            </div>
            <p className="max-w-4xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              {endpoint.description}
            </p>
          </div>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-2">
          {endpoint.pathParams && endpoint.pathParams.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/70">
              <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t("path")} {t("parameters")}
              </h4>
              <div className="space-y-3">
                {endpoint.pathParams.map((param) => (
                  <div key={param.name} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900">
                    <div className="api-docs-mono text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                      {param.name}
                    </div>
                    <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {param.value}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {endpoint.body && (
            <section className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-slate-100 shadow-inner dark:border-slate-800">
              <h4 className="mb-3 text-sm font-semibold text-white">
                {t("body")}
              </h4>
              <pre className="api-docs-mono overflow-x-auto whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-100">
                {endpoint.body}
              </pre>
            </section>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

export default function ApiDocsPage() {
  const navRouter = useRouter()
  const pathname = usePathname()
  const locale = useLocale()
  const isZh = locale === "zh"
  const t = useTranslations("apiDocs")
  const [copySuccess, setCopySuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const llmDocsUrl =
    typeof window === "undefined"
      ? "/llm-api-docs.txt"
      : `${window.location.origin}/llm-api-docs.txt`
  const exampleDomain = DEFAULT_DOMAIN || EXAMPLE_DOMAIN

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
          body: `{\n  "domain": "mail.example.com"\n}`,
        },
        {
          method: "GET",
          path: "/domains/{id}/records",
          description: t("domainRecordsDesc"),
          authType: "required-apikey",
          pathParams: [{ name: "id", value: "domain-id" }],
        },
        {
          method: "POST",
          path: "/domains/{id}/verify",
          description: t("domainVerifyDesc"),
          authType: "required-apikey",
          pathParams: [{ name: "id", value: "domain-id" }],
          body: "{}",
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
          body: `{\n  "address": "user@${exampleDomain}",\n  "password": "your_password",\n  "expiresIn": 0\n}`,
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
          pathParams: [{ name: "id", value: "account-id" }],
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
          body: `{\n  "address": "user@${exampleDomain}",\n  "password": "your_password"\n}`,
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
          pathParams: [{ name: "id", value: "message-id" }],
        },
        {
          method: "DELETE",
          path: "/messages/{id}",
          description: t("messageDeleteDesc"),
          authType: "required-token",
          pathParams: [{ name: "id", value: "message-id" }],
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

  return (
    <div
      className={cn(
        "api-docs-page min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.08),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100",
        isPending && "pointer-events-none opacity-60",
      )}
    >
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Button
            className="rounded-full bg-white/80 px-4 text-slate-700 shadow-sm backdrop-blur dark:bg-slate-950/70 dark:text-slate-200"
            startContent={<ArrowLeft size={16} />}
            variant="flat"
            onPress={() => navRouter.push("/")}
          >
            {t("back")}
          </Button>
          <Button
            className="rounded-full bg-white/80 px-4 text-slate-700 shadow-sm backdrop-blur dark:bg-slate-950/70 dark:text-slate-200"
            startContent={<Languages size={16} />}
            variant="flat"
            onPress={toggleLocale}
          >
            {t("language")}
          </Button>
        </div>

        <header className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-8 lg:p-10 dark:border-slate-800/80 dark:bg-slate-950/70 dark:shadow-none">
          <div className="absolute inset-y-0 right-0 hidden w-80 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_58%)] lg:block dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_58%)]" />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_320px]">
            <div className="min-w-0">
              <div
                className={cn(
                  "mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
                  isZh ? "tracking-[0.08em]" : "uppercase tracking-[0.22em]",
                )}
              >
                <ReceiptText size={14} />
                {t("title")}
              </div>
              <h1
                className={cn(
                  "max-w-4xl text-4xl font-semibold text-slate-950 md:text-5xl dark:text-white",
                  isZh ? "tracking-normal" : "tracking-tight",
                )}
              >
                {t("subtitle", { brand: BRAND_NAME })}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600 dark:text-slate-300">
                {t("description")}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <span
                  className={cn(
                    "rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-950",
                    isZh ? "tracking-[0.06em]" : "uppercase tracking-[0.16em]",
                  )}
                >
                  {t("baseUrl")}: {DEFAULT_PROVIDER_BASE_URL}
                </span>
                <span
                  className={cn(
                    "rounded-full bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
                    isZh ? "tracking-[0.06em]" : "uppercase tracking-[0.16em]",
                  )}
                >
                  {t("apiKey")}
                </span>
              </div>
            </div>

            <div className="min-w-0 rounded-[1.75rem] border border-slate-200 bg-slate-950 p-5 text-slate-100 shadow-inner dark:border-slate-800">
              <div
                className={cn(
                  "mb-3 text-xs font-semibold text-slate-400",
                  isZh ? "tracking-[0.08em]" : "uppercase tracking-[0.2em]",
                )}
              >
                {t("example")}
              </div>
              <pre className="api-docs-mono overflow-x-auto whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-100">
{`curl -X POST ${DEFAULT_PROVIDER_BASE_URL}/token \\
  -H "Content-Type: application/json" \\
  -d '{
    "address": "user@${exampleDomain}",
    "password": "your_password"
  }'`}
              </pre>
            </div>
          </div>
        </header>

        <main className="mt-8 space-y-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <Card className="border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
              <CardBody className="gap-4 p-6">
                <div className="flex items-center gap-3">
                  <FileText className="text-sky-600 dark:text-sky-300" size={20} />
                  <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                    {t("llmDocs")}
                  </h2>
                </div>
                <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
                  {t("llmDocsDescription")}
                </p>
                <div className="overflow-x-auto rounded-2xl bg-slate-950 p-4">
                  <code className="api-docs-mono break-all text-[13px] text-slate-100 sm:break-normal">
                    {llmDocsUrl}
                  </code>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    as="a"
                    className="rounded-full bg-sky-600 px-4 text-white hover:bg-sky-700"
                    color="primary"
                    href={llmDocsUrl}
                    rel="noopener noreferrer"
                    startContent={<ExternalLink size={16} />}
                    target="_blank"
                  >
                    {t("openLink")}
                  </Button>
                  <Button
                    className="rounded-full border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    color={copySuccess ? "success" : "default"}
                    startContent={<FileText size={16} />}
                    variant="bordered"
                    onPress={async () => {
                      try {
                        await navigator.clipboard.writeText(llmDocsUrl)
                        setCopySuccess(true)
                        setTimeout(() => setCopySuccess(false), 2000)
                      } catch {}
                    }}
                  >
                    {copySuccess ? t("copySuccess") : t("copyLink")}
                  </Button>
                </div>
              </CardBody>
            </Card>

            <Card className="border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
              <CardBody className="grid gap-5 p-6 md:grid-cols-2">
                <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <Info size={16} />
                    {t("generalInfo")}
                  </div>
                  <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {t("baseUrl")}
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <code className="api-docs-mono inline-flex min-w-fit rounded-xl bg-slate-950 px-3 py-2 text-[13px] text-slate-100">
                      {DEFAULT_PROVIDER_BASE_URL}
                    </code>
                  </div>
                </div>

                <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <KeyRound size={16} />
                    {t("auth")}
                  </div>
                  <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {t("authDescription")}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {t("apiKeyDescription")}
                  </p>
                </div>
              </CardBody>
            </Card>
          </div>

          <Card className="border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
            <CardBody className="gap-6 p-4 md:p-6">
              <div className="flex items-center gap-3">
                <Server className="text-sky-600 dark:text-sky-300" size={20} />
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                  {t("endpoints")}
                </h2>
              </div>

              <div className="space-y-8">
                {apiEndpoints.map((group) => (
                  <section key={group.group} className="space-y-4">
                    <div className="border-b border-slate-200/80 pb-3 dark:border-slate-800">
                      <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                        {group.group}
                      </h3>
                    </div>
                    <div className="space-y-5">
                      {group.endpoints.map((endpoint) => (
                        <ApiEndpointCard
                          key={`${group.group}-${endpoint.method}-${endpoint.path}`}
                          endpoint={endpoint}
                          isZh={isZh}
                          t={t}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card className="border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
            <CardBody className="gap-4 p-6">
              <div className="flex items-center gap-3">
                <ReceiptText className="text-sky-600 dark:text-sky-300" size={20} />
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                  {t("contributions")}
                </h2>
              </div>
              <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
                {t("contributionsDescription")}
              </p>
              <div className="flex flex-wrap gap-3">
                {BRAND_REPO_URL && (
                  <Button
                    as="a"
                    className="rounded-full bg-sky-600 px-4 text-white hover:bg-sky-700"
                    color="primary"
                    endContent={<ExternalLink size={14} />}
                    href={BRAND_REPO_URL}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t("githubRepo")}
                  </Button>
                )}
                <Button
                  as="a"
                  className="rounded-full border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  href="mailto:syferie@proton.me"
                  variant="bordered"
                >
                  {t("contactUs")}
                </Button>
              </div>
            </CardBody>
          </Card>
        </main>
      </div>
    </div>
  )
}
