import { NextResponse } from "next/server"

import { adminFetch } from "@/lib/admin"
import { requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string; executionId: string }>
}

export async function POST(_request: Request, context: RouteContext) {
  const { id, executionId } = await context.params

  if (!useLocalAppApi()) {
    const response = await adminFetch(
      `/api/admin/change-board/requests/${id}/executions/${executionId}/stop`,
      { method: "POST" },
    )
    const text = await response.text()
    const contentType = response.headers.get("content-type") ?? "application/json"
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": contentType },
    })
  }

  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json(
    {
      ok: false,
      error: "CHANGE_REQUEST_EXECUTIONS_DEPRECATED",
      message: "Use the workflow cancel route to cancel active agent runs.",
    },
    { status: 410 },
  )
}
