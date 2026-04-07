import { getRequestConfig } from "next-intl/server"
import { routing } from "./routing"

type AppLocale = (typeof routing.locales)[number]

function isAppLocale(value: string): value is AppLocale {
  return routing.locales.includes(value as AppLocale)
}

export default getRequestConfig(async ({ requestLocale }) => {
  // 获取请求的 locale
  let locale = await requestLocale

  // 验证 locale 有效性，无效时回退到默认值
  if (!locale || !isAppLocale(locale)) {
    locale = routing.defaultLocale
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
