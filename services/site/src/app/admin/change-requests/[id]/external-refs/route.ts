import { NextResponse } from "next/server"
import { getChangeRequest, listRequestExternalRefs, upsertRequestExternalRef } from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import { readOptionalInteger } from "@/lib/internal-service"
import { readRouteParam, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params
  const url = new URL(request.url)
  const rawLimit = readOptionalInteger(url.searchParams.get("limit")) ?? 100
  const limit = Math.min(500, Math.max(1, rawLimit))

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    const requestId = readRouteParam(id)
    if (!getChangeRequest(requestId)) {
      return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, externalRefs: listRequestExternalRefs(requestId, limit) })
  }

  const response = await adminFetch(`/api/admin/change-board/requests/${id}/external-refs?limit=${limit}`)
  const text = await response.text()
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  })
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params
  const payload = await request.text()

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    const requestId = readRouteParam(id)
    if (!getChangeRequest(requestId)) {
      return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
    }

    let body: unknown = null
    try {
      body = payload ? JSON.parse(payload) : {}
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
    }
    const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {}
    const stringValue = (value: unknown) => typeof value === "string" ? value.trim() : ""
    try {
      const externalRef = upsertRequestExternalRef({
        requestId,
        provider: stringValue(record.provider),
        kind: stringValue(record.kind),
        externalId: stringValue(record.externalId ?? record.external_id) || null,
        title: stringValue(record.title) || null,
        url: stringValue(record.url),
        state: stringValue(record.state) || null,
        metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata) ? record.metadata as Record<string, unknown> : {},
        createdBy: stringValue(record.createdBy ?? record.created_by) || "admin",
      })
      return NextResponse.json({ ok: true, externalRef }, { status: 201 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ ok: false, error: message }, { status: message.includes("REQUIRED") ? 400 : 500 })
    }
  }

  const response = await adminFetch(`/api/admin/change-board/requests/${id}/external-refs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: payload,
  })
  const text = await response.text()
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  })
}
