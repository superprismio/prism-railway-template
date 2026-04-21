import { NextResponse } from "next/server"

import { adminFetch } from "@/lib/admin"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: RouteContext) {
  let payload: unknown = null

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const { id } = await context.params
  const response = await adminFetch(`/api/admin/change-board/requests/${id}/agent-session/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  const contentType = response.headers.get("content-type") ?? "application/json"

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  })
}
