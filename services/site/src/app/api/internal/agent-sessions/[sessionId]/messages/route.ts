import { NextResponse } from "next/server"
import { createAgentMessage } from "@/lib/app-core"

import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const { sessionId } = await context.params
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const role = parseString(body.role)
  const source = parseString(body.source) || "discord"
  const content = parseString(body.content)

  if (!role || !content) {
    return NextResponse.json({ ok: false, error: "role and content are required" }, { status: 400 })
  }

  const message = createAgentMessage({
    sessionId: readRouteParam(sessionId),
    role,
    source,
    sourceMessageId: parseNullableString(body.sourceMessageId ?? body.source_message_id) ?? null,
    content,
    meta: body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? body.meta as Record<string, unknown> : {},
    createdAt: parseNullableString(body.createdAt ?? body.created_at) ?? null,
  })

  if (!message) {
    return NextResponse.json({ ok: false, error: "Agent session not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, message }, { status: 201 })
}
