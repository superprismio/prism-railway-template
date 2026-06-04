import { NextResponse } from "next/server"
import { listAgentRuns } from "@/lib/app-core"
import { parseString, readOptionalInteger, requireServiceAccess } from "@/lib/internal-service"

export async function GET(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const limit = readOptionalInteger(url.searchParams.get("limit")) ?? 50
  const kind = parseString(url.searchParams.get("kind"))
  const status = parseString(url.searchParams.get("status"))
  const requestId = parseString(url.searchParams.get("requestId") ?? url.searchParams.get("request_id"))

  return NextResponse.json({
    ok: true,
    runs: listAgentRuns({ kind, status, requestId, limit }),
  })
}
