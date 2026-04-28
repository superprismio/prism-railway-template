import { NextResponse } from "next/server"
import {
  findLatestAgentSessionByChangeRequest,
  getChangeRequest,
  listAgentMessages,
} from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import { readRouteParam, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    const changeRequestId = readRouteParam(id)
    const changeRequest = getChangeRequest(changeRequestId)
    if (!changeRequest) {
      return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
    }

    const session = findLatestAgentSessionByChangeRequest(changeRequestId)
    if (!session) {
      return NextResponse.json({ ok: true, session: null, messages: [] })
    }

    return NextResponse.json({
      ok: true,
      session,
      messages: listAgentMessages(session.id, 100),
    })
  }

  const response = await adminFetch(`/api/admin/change-board/requests/${id}/agent-session`)

  const text = await response.text()
  const contentType = response.headers.get("content-type") ?? "application/json"

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  })
}
