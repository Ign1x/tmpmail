import type React from "react"
import type { Metadata } from "next"
import { Inter, JetBrains_Mono, Noto_Sans_SC } from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getMessages, setRequestLocale } from "next-intl/server"
import { routing } from "@/i18n/routing"
import { notFound } from "next/navigation"
import "../globals.css"
import { Providers } from "./providers"
import { BRAND_NAME } from "@/lib/provider-config"
import { MailStatusProvider } from "@/contexts/mail-status-context"
import { AuthProvider } from "@/contexts/auth-context"

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

  const isZh = locale === "zh"

  return {
    title: isZh
      ? `Temp Mail-临时邮件-安全、即时、快速- ${BRAND_NAME}`
      : `Temp Mail - Secure, Instant, Fast - ${BRAND_NAME}`,
    description: isZh
      ? `使用 ${BRAND_NAME} 保护您的个人邮箱地址免受垃圾邮件、机器人、钓鱼和其他在线滥用。`
      : `Protect your personal email address from spam, bots, phishing, and other online abuse with ${BRAND_NAME}.`,
    icons: {
      icon: "/brand-mark.svg",
      shortcut: "/brand-mark.svg",
      apple: "/brand-mark.svg",
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
          <Providers>
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
