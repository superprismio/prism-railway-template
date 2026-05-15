import { NextResponse } from "next/server"
import { createAuditLog, getTargetEnvironment, updateTargetEnvironment } from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import {
  parseNullableString,
  readRouteParam,
  requireLocalAdminAccess,
  useLocalAppApi,
} from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

function parseBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined
}

export async function PATCH(request: Request, context: RouteContext) {
  let payload: unknown = null

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const { id } = await context.params
  const targetEnvironmentId = readRouteParam(id)

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
    }

    const existing = getTargetEnvironment(targetEnvironmentId)
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Target environment not found" }, { status: 404 })
    }

    const body = payload as Record<string, unknown>
    const branch =
      body.branch !== undefined
        ? parseNullableString(body.branch) ?? null
        : undefined

    const targetEnvironment = updateTargetEnvironment(targetEnvironmentId, {
      branch,
      agentWritable: parseBoolean(body.agentWritable ?? body.agent_writable),
      isDefaultForAgent: parseBoolean(body.isDefaultForAgent ?? body.is_default_for_agent),
    })

    if (!targetEnvironment) {
      return NextResponse.json({ ok: false, error: "Target environment not found" }, { status: 404 })
    }

    createAuditLog({
      actorUserId: null,
      actionType: "admin.target_environment.update",
      targetType: "target_environment",
      targetId: targetEnvironment.id,
      meta: {
        targetAppId: targetEnvironment.targetAppId,
        branch: targetEnvironment.branch,
        agentWritable: targetEnvironment.agentWritable,
        isDefaultForAgent: targetEnvironment.isDefaultForAgent,
      },
    })

    return NextResponse.json({ ok: true, targetEnvironment })
  }

  const response = await adminFetch(`/api/admin/target-environments/${targetEnvironmentId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  const contentType = response.headers.get("content-type") ?? "application/json"

  return new NextResponse(text, {
    status: response.status,
    headers: { "content-type": contentType },
  })
}
