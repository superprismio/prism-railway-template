import { NextResponse } from "next/server"
import { getChangeRequest, listRequestArtifacts } from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import { readOptionalInteger } from "@/lib/internal-service"
import { readRouteParam, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params
  const url = new URL(request.url)
  const limit = readOptionalInteger(url.searchParams.get("limit")) ?? 100

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    const requestId = readRouteParam(id)
    if (!getChangeRequest(requestId)) {
      return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, artifacts: listRequestArtifacts(requestId, limit) })
  }

  const response = await adminFetch(`/api/admin/change-board/requests/${id}/artifacts?limit=${limit}`)
  const text = await response.text()
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  })
}
