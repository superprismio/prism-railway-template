import { NextResponse } from "next/server"

import { getAgentResponseJob } from "@/lib/app-core"
import { requireLocalAdminAccess } from "@/lib/local-admin-api"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await params
  const job = getAgentResponseJob(id)
  if (!job) {
    return NextResponse.json({ ok: false, error: "Console job not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, job })
}
