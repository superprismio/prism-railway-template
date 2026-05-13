import { NextResponse } from "next/server"

import { requireLocalAdminAccess } from "@/lib/local-admin-api"
import { triggerHook } from "@/lib/hook-trigger"

type RouteContext = {
  params: Promise<{ key: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const { key } = await context.params
  try {
    const result = await triggerHook(decodeURIComponent(key), payload ?? {}, {
      baseUrl: new URL(request.url).origin,
      source: "admin-hook-test",
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not trigger hook"
    const status = message === "HOOK_NOT_FOUND" ? 404 : message === "HOOK_DISABLED" ? 409 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
