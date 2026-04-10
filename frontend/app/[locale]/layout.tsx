import type React from "react"
import type { Metadata } from "next"
import { Inter, JetBrains_Mono, Noto_Sans_SC } from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getMessages, setRequestLocale } from "next-intl/server"
import { routing } from "@/i18n/routing"
import { notFound } from "next/navigation"
import "../globals.css"
import { Providers } from "./providers"
import { MailStatusProvider } from "@/contexts/mail-status-context"
import { AuthProvider } from "@/contexts/auth-context"
import { getServerSiteBranding } from "@/lib/site-branding-server"
import {
  buildSiteDescription,
  buildSiteTitle,
  resolveMetadataBrandLogoUrl,
} from "@/lib/site-branding"

type AppLocale = (typeof routing.locales)[number]

function isAppLocale(value: string): value is AppLocale {
  return routing.locales.includes(value as AppLocale)
}

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
})

const notoSansSc = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-noto-sans-sc",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
})

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const branding = await getServerSiteBranding()
  const metadataLogoUrl = resolveMetadataBrandLogoUrl(branding.brandLogoUrl)

  return {
    title: buildSiteTitle(locale, branding.brandName),
    description: buildSiteDescription(locale, branding.brandName),
    icons: {
      icon: metadataLogoUrl,
      shortcut: metadataLogoUrl,
      apple: metadataLogoUrl,
    },
    alternates: {
      languages: {
        zh: "/zh",
        en: "/en",
      },
    },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const branding = await getServerSiteBranding()

  // 验证 locale 有效性
  if (!isAppLocale(locale)) {
    notFound()
  }

  // 启用静态渲染
  setRequestLocale(locale)

  // 获取翻译消息
  const messages = await getMessages()

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${notoSansSc.variable} ${jetbrainsMono.variable}`}
      >
        <NextIntlClientProvider messages={messages}>
          <Providers initialBranding={branding}>
            <AuthProvider>
              <MailStatusProvider>
                {children}
              </MailStatusProvider>
            </AuthProvider>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
