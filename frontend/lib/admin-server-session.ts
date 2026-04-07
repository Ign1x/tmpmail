import { cookies } from "next/headers"

import { ADMIN_SESSION_COOKIE_KEY } from "@/lib/admin-session-cookie"

export async function hasServerAdminSessionCookie(): Promise<boolean> {
  const cookieStore = await cookies()
  return Boolean(cookieStore.get(ADMIN_SESSION_COOKIE_KEY)?.value?.trim())
}
