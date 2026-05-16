import { NextResponse } from "next/server"
import { createAuditLog, getTargetApp, updateTargetApp } from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import {
  parseNullableString,
  parseString,
  readRouteParam,
  requireLocalAdminAccess,
  useLocalAppApi,
} from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

function parseBoolean(value: unknown, fieldName: string) {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value !== "boolean") {
    throw new TypeError(`${fieldName} must be a boolean`)
  }
  return value
}

export async function PATCH(request: Request, context: RouteContext) {
  let payload: unknown = null

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const { id } = await context.params
  const targetAppId = readRouteParam(id)

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
    }

    const existing = getTargetApp(targetAppId)
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Target app not found" }, { status: 404 })
    }

    const body = payload as Record<string, unknown>
    const name = body.name !== undefined ? parseString(body.name) : undefined
    const defaultBranch = body.defaultBranch !== undefined || body.default_branch !== undefined
      ? parseString(body.defaultBranch ?? body.default_branch)
      : undefined
    if (name !== undefined && !name) {
      return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 })
    }
    if (defaultBranch !== undefined && !defaultBranch) {
      return NextResponse.json({ ok: false, error: "Target branch is required" }, { status: 400 })
    }

    let agentEnabled: boolean | undefined
    try {
      agentEnabled = parseBoolean(body.agentEnabled ?? body.agent_enabled, "agentEnabled")
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "Invalid boolean value" },
        { status: 400 },
      )
    }

    const targetApp = updateTargetApp(targetAppId, {
      name,
      description:
        body.description !== undefined
          ? parseNullableString(body.description) ?? null
          : undefined,
      repoUrl:
        body.repoUrl !== undefined || body.repo_url !== undefined
          ? parseNullableString(body.repoUrl ?? body.repo_url) ?? null
          : undefined,
      defaultBranch,
      agentEnabled,
    })

    if (!targetApp) {
      return NextResponse.json({ ok: false, error: "Target app not found" }, { status: 404 })
    }

    createAuditLog({
      actorUserId: null,
      actionType: "admin.target_app.update",
      targetType: "target_app",
      targetId: targetApp.id,
      meta: {
        name: targetApp.name,
        repoUrl: targetApp.repoUrl,
        defaultBranch: targetApp.defaultBranch,
        agentEnabled: targetApp.agentEnabled,
      },
    })

    return NextResponse.json({ ok: true, targetApp })
  }

  const response = await adminFetch(`/api/admin/target-apps/${targetAppId}`, {
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
