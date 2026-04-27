import { NextResponse } from "next/server"
import { getAgentSession, listAgentMessages } from "@prism-railway/app-core"

import { readOptionalInteger, requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { sessionId } = await context.params
  const resolvedSessionId = readRouteParam(sessionId)
  const session = getAgentSession(resolvedSessionId)

  if (!session) {
    return NextResponse.json({ ok: false, error: "Agent session not found" }, { status: 404 })
  }

  const url = new URL(request.url)
  const limit = readOptionalInteger(url.searchParams.get("limit")) ?? 100
  return NextResponse.json({ ok: true, session, messages: listAgentMessages(resolvedSessionId, limit) })
}
