import { NextResponse } from "next/server"
import { listTargetApps } from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, targetApps: listTargetApps() })
}
