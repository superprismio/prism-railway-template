import { NextResponse } from "next/server"
import { updateChangeRequestExecution } from "@/lib/app-core"

import { parseNullableString, requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ executionId: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
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

  const { executionId } = await context.params
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const execution = updateChangeRequestExecution(readRouteParam(executionId), {
    status: typeof body.status === "string" ? body.status : undefined,
    targetEnvironmentId:
      body.targetEnvironmentId !== undefined || body.target_environment_id !== undefined
        ? parseNullableString(body.targetEnvironmentId ?? body.target_environment_id) ?? null
        : undefined,
    branchName:
      body.branchName !== undefined || body.branch_name !== undefined
        ? parseNullableString(body.branchName ?? body.branch_name) ?? null
        : undefined,
    commitSha:
      body.commitSha !== undefined || body.commit_sha !== undefined
        ? parseNullableString(body.commitSha ?? body.commit_sha) ?? null
        : undefined,
    deployUrl:
      body.deployUrl !== undefined || body.deploy_url !== undefined
        ? parseNullableString(body.deployUrl ?? body.deploy_url) ?? null
        : undefined,
    adapterKind:
      body.adapterKind !== undefined || body.adapter_kind !== undefined
        ? parseNullableString(body.adapterKind ?? body.adapter_kind) ?? null
        : undefined,
    adapterStatus:
      body.adapterStatus !== undefined || body.adapter_status !== undefined
        ? parseNullableString(body.adapterStatus ?? body.adapter_status) ?? null
        : undefined,
    summary: body.summary !== undefined ? parseNullableString(body.summary) ?? null : undefined,
    errorMessage:
      body.errorMessage !== undefined || body.error_message !== undefined
        ? parseNullableString(body.errorMessage ?? body.error_message) ?? null
        : undefined,
    meta: body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? body.meta as Record<string, unknown> : undefined,
    startedAt:
      body.startedAt !== undefined || body.started_at !== undefined
        ? parseNullableString(body.startedAt ?? body.started_at) ?? null
        : undefined,
    finishedAt:
      body.finishedAt !== undefined || body.finished_at !== undefined
        ? parseNullableString(body.finishedAt ?? body.finished_at) ?? null
        : undefined,
  })

  if (!execution) {
    return NextResponse.json({ ok: false, error: "Execution not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, execution })
}
