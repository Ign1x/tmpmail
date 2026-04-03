import LinuxDoCallbackPage from "@/components/linux-do-callback-page"

export const dynamic = "force-dynamic"

export default async function LinuxDoAuthCallbackRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ code?: string; error?: string; state?: string }>
}) {
  const { locale } = await params
  const query = await searchParams
  const homePath = `/${locale}`
  const callbackPath = `${homePath}/auth/linux-do`

  return (
    <LinuxDoCallbackPage
      callbackPath={callbackPath}
      code={query.code}
      error={query.error}
      homePath={homePath}
      state={query.state}
    />
  )
}
