import { type NextRequest, NextResponse } from "next/server"

import { clearAdminSessionCookie } from "@/lib/admin-session-server"

export async function DELETE(request: NextRequest): Promise<Response> {
  const response = new NextResponse(null, { status: 204 })
  clearAdminSessionCookie(response, request)
  return response
}
