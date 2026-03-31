"use client"

import { useState, useTransition } from "react"
import { Button } from "@heroui/button"
import { ArrowLeft, Check, ExternalLink, Languages, Link2 } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { usePathname, useRouter } from "@/i18n/navigation"
import {
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
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/80 dark:bg-sky-950/40 dark:text-sky-300"
    case "POST":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-300"
    case "DELETE":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/40 dark:text-rose-300"
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
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

function ApiEndpointDoc({
  endpoint,
  t,
}: {
  endpoint: ApiEndpoint
  t: (key: string) => string
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-start gap-3">
          <span
            className={cn(
              "inline-flex min-w-[72px] justify-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
              methodBadgeClassName(endpoint.method),
            )}
          >
            {endpoint.method}
          </span>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <code className="api-docs-mono inline-flex min-w-fit rounded-xl bg-slate-950 px-3 py-2 text-[13px] text-slate-100 dark:bg-black">
              {endpoint.path}
            </code>
          </div>
        </div>

        <dl className="mt-5 space-y-3 text-sm leading-7">
          <div className="grid gap-1 md:grid-cols-[120px_1fr]">
            <dt className="font-medium text-slate-500 dark:text-slate-400">
              {t("authorization")}
            </dt>
            <dd className="text-slate-800 dark:text-slate-200">
              {authLabel(endpoint.authType, t)}
            </dd>
          </div>
          <div className="grid gap-1 md:grid-cols-[120px_1fr]">
            <dt className="font-medium text-slate-500 dark:text-slate-400">
              {t("descriptionTitle")}
            </dt>
            <dd className="text-slate-700 dark:text-slate-300">
              {endpoint.description}
            </dd>
          </div>
        </dl>

        {endpoint.pathParams && endpoint.pathParams.length > 0 && (
          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
              {t("path")} {t("parameters")}
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {endpoint.pathParams.map((param) => (
                <div
                  key={param.name}
                  className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[140px_1fr]"
                >
                  <div className="api-docs-mono font-semibold text-slate-900 dark:text-slate-100">
                    {param.name}
                  </div>
                  <div className="text-slate-700 dark:text-slate-300">
                    {param.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {endpoint.body && (
          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
              {t("body")}
            </div>
            <pre className="api-docs-mono overflow-x-auto bg-slate-950 px-4 py-4 text-[13px] leading-6 text-slate-100">
              {endpoint.body}
            </pre>
          </div>
        )}
      </div>
    </section>
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

  const llmDocsPath = "/llm-api-docs.txt"
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
        "min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100",
        isPending && "pointer-events-none opacity-60",
      )}
    >
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Button
            className="rounded-full border border-slate-200 bg-white px-4 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            startContent={<ArrowLeft size={16} />}
            variant="flat"
            onPress={() => navRouter.push("/")}
          >
            {t("back")}
          </Button>
          <Button
            className="rounded-full border border-slate-200 bg-white px-4 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            startContent={<Languages size={16} />}
            variant="flat"
            onPress={toggleLocale}
          >
            {t("language")}
          </Button>
        </div>

        <article className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <header className="border-b border-slate-200 px-6 py-8 md:px-8 md:py-10 dark:border-slate-800">
            <p
              className={cn(
                "text-xs font-semibold text-slate-500 dark:text-slate-400",
                isZh ? "tracking-[0.08em]" : "uppercase tracking-[0.2em]",
              )}
            >
              {t("title")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl dark:text-white">
              {t("subtitle")}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-600 dark:text-slate-300">
              {t("description")}
            </p>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                  {t("baseUrl")}
                </h2>
                <div className="mt-3 overflow-x-auto">
                  <code className="api-docs-mono block break-all text-[13px] leading-6 text-slate-700 dark:text-slate-200">
                    {DEFAULT_PROVIDER_BASE_URL}
                  </code>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                  {t("auth")}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  {t("authDescription")}
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  {t("apiKeyDescription")}
                </p>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="flex items-start gap-2">
                  <Link2 className="mt-0.5 text-slate-500 dark:text-slate-400" size={16} />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {t("llmDocs")}
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                      {t("llmDocsDescription")}
                    </p>
                    <div className="mt-3 overflow-x-auto rounded-xl bg-slate-950 px-3 py-2">
                      <code className="api-docs-mono block break-all text-[13px] leading-6 text-slate-100">
                        {llmDocsPath}
                      </code>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        as="a"
                        className="rounded-full bg-slate-950 px-4 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200"
                        href={llmDocsPath}
                        rel="noopener noreferrer"
                        startContent={<ExternalLink size={16} />}
                        target="_blank"
                      >
                        {t("openLink")}
                      </Button>
                      <Button
                        className="rounded-full border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        startContent={copySuccess ? <Check size={16} /> : <Link2 size={16} />}
                        variant="bordered"
                        onPress={copyLlmDocsLink}
                      >
                        {copySuccess ? t("copySuccess") : t("copyLink")}
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </header>

          <div className="space-y-10 px-6 py-8 md:px-8 md:py-10">
            <section>
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                {t("example")}
              </h2>
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                <pre className="api-docs-mono overflow-x-auto bg-slate-950 px-4 py-5 text-[13px] leading-6 text-slate-100">
{`curl -X POST ${DEFAULT_PROVIDER_BASE_URL}/token \\
  -H "Content-Type: application/json" \\
  -d '{
    "address": "user@${exampleDomain}",
    "password": "your_password"
  }'`}
                </pre>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                {t("endpoints")}
              </h2>
              <div className="mt-6 space-y-8">
                {apiEndpoints.map((group) => (
                  <section key={group.group}>
                    <div className="mb-4 border-b border-slate-200 pb-3 dark:border-slate-800">
                      <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                        {group.group}
                      </h3>
                    </div>
                    <div className="space-y-4">
                      {group.endpoints.map((endpoint) => (
                        <ApiEndpointDoc
                          key={`${group.group}-${endpoint.method}-${endpoint.path}`}
                          endpoint={endpoint}
                          t={t}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <footer className="border-t border-slate-200 pt-6 dark:border-slate-800">
              <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
                {t("contributionsDescription")}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {BRAND_REPO_URL && (
                  <Button
                    as="a"
                    className="rounded-full bg-slate-950 px-4 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200"
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
            </footer>
          </div>
        </article>
      </div>
    </div>
  )
}
