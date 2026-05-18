import { NextResponse } from "next/server"

import { loadConfig, readSourceAdapterPolicy, writeSourceAdapterPolicy } from "@/lib/app-core"
import { requireServiceAccess } from "@/lib/internal-service"

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, policy: readSourceAdapterPolicy(loadConfig()) })
}

export async function PATCH(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  return NextResponse.json({ ok: true, policy: writeSourceAdapterPolicy(loadConfig(), body.policy ?? body) })
}
