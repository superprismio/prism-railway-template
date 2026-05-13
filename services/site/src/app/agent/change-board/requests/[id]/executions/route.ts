import { NextResponse } from "next/server"
import { createChangeRequestExecution, getChangeRequest, listChangeRequestExecutions } from "@/lib/app-core"

import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

function isTriageOnlyStatus(status: string | null | undefined) {
  return status === "submitted"
}

function hasActiveExecution(changeRequestId: string) {
  return listChangeRequestExecutions(changeRequestId).some((execution) => ["planned", "running"].includes(execution.status))
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const changeRequestId = readRouteParam(id)
  const changeRequest = getChangeRequest(changeRequestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, executions: listChangeRequestExecutions(changeRequestId) })
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

  const { id } = await context.params
  const changeRequestId = readRouteParam(id)
  const changeRequest = getChangeRequest(changeRequestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }
  if (isTriageOnlyStatus(changeRequest.status)) {
    return NextResponse.json({ ok: false, error: "CHANGE_REQUEST_NOT_READY_FOR_EXECUTION" }, { status: 409 })
  }
  if (hasActiveExecution(changeRequestId)) {
    return NextResponse.json({ ok: false, error: "CHANGE_REQUEST_EXECUTION_ALREADY_RUNNING" }, { status: 409 })
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const execution = createChangeRequestExecution({
    changeRequestId,
    targetEnvironmentId: parseNullableString(body.targetEnvironmentId ?? body.target_environment_id) ?? changeRequest.targetEnvironmentId,
    status: parseString(body.status) || "planned",
    actorType: parseString(body.actorType ?? body.actor_type) || "codex",
    branchName: parseNullableString(body.branchName ?? body.branch_name) ?? null,
    commitSha: parseNullableString(body.commitSha ?? body.commit_sha) ?? null,
    deployUrl: parseNullableString(body.deployUrl ?? body.deploy_url) ?? null,
    adapterKind: parseNullableString(body.adapterKind ?? body.adapter_kind) ?? null,
    adapterStatus: parseNullableString(body.adapterStatus ?? body.adapter_status) ?? null,
    summary: parseNullableString(body.summary) ?? null,
    errorMessage: parseNullableString(body.errorMessage ?? body.error_message) ?? null,
    meta: body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? body.meta as Record<string, unknown> : {},
    startedAt: parseNullableString(body.startedAt ?? body.started_at) ?? null,
    finishedAt: parseNullableString(body.finishedAt ?? body.finished_at) ?? null,
  })

  return NextResponse.json({ ok: true, execution }, { status: 201 })
}
