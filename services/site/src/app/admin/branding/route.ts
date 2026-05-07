import { NextResponse } from "next/server"

import { requireLocalAdminAccess } from "@/lib/local-admin-api"
import { updateSiteBranding } from "@/lib/site-branding"

export async function PATCH(request: Request) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const branding = updateSiteBranding(body)
  return NextResponse.json({ ok: true, branding })
}
