import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  getChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  listChangeRequestExecutions,
  updateChangeRequest,
} from "@prism-railway/app-core"

import { parseNullableString, requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam, trackedChangeRequestPriorities, trackedChangeRequestStatuses } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

function isTriageOnlyStatus(status: string | null | undefined) {
  return ["submitted", "triaging", "needs-human-input"].includes(status ?? "")
}

function isExecutionStatus(status: string | null | undefined) {
  return ["in-progress", "awaiting-review", "changes-requested", "approved", "closed"].includes(status ?? "")
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const changeRequest = getChangeRequest(readRouteParam(id))
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const targetApp = getTargetApp(changeRequest.targetAppId)
  const targetEnvironment = changeRequest.targetEnvironmentId ? getTargetEnvironment(changeRequest.targetEnvironmentId) : null
  const latestExecution = listChangeRequestExecutions(changeRequest.id)[0] ?? null
  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({ request: changeRequest, targetApp, targetEnvironment })
    : null

  return NextResponse.json({ ok: true, changeRequest, targetApp, targetEnvironment, deployPlan, latestExecution })
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

  const { id } = await context.params
  const changeRequestId = readRouteParam(id)
  const existingChangeRequest = getChangeRequest(changeRequestId)
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const nextStatus = typeof body.status === "string" ? body.status : undefined
  const nextPriority = typeof body.priority === "string" ? body.priority : undefined

  if (!existingChangeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }
  if (nextStatus && !trackedChangeRequestStatuses.includes(nextStatus as typeof trackedChangeRequestStatuses[number])) {
    return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 })
  }
  if (nextPriority && !trackedChangeRequestPriorities.includes(nextPriority as typeof trackedChangeRequestPriorities[number])) {
    return NextResponse.json({ ok: false, error: "Invalid priority" }, { status: 400 })
  }
  if (nextStatus && isTriageOnlyStatus(existingChangeRequest.status) && isExecutionStatus(nextStatus)) {
    return NextResponse.json({ ok: false, error: "CHANGE_REQUEST_NOT_READY_FOR_EXECUTION" }, { status: 409 })
  }

  const changeRequest = updateChangeRequest(changeRequestId, {
    status: nextStatus,
    priority: nextPriority,
    targetEnvironmentId:
      body.targetEnvironmentId !== undefined || body.target_environment_id !== undefined
        ? parseNullableString(body.targetEnvironmentId ?? body.target_environment_id) ?? null
        : undefined,
    triageSummary:
      body.triageSummary !== undefined || body.triage_summary !== undefined
        ? parseNullableString(body.triageSummary ?? body.triage_summary) ?? null
        : undefined,
    reviewNotes:
      body.reviewNotes !== undefined || body.review_notes !== undefined
        ? parseNullableString(body.reviewNotes ?? body.review_notes) ?? null
        : undefined,
    resolutionSummary:
      body.resolutionSummary !== undefined || body.resolution_summary !== undefined
        ? parseNullableString(body.resolutionSummary ?? body.resolution_summary) ?? null
        : undefined,
    agentRecommendation:
      body.agentRecommendation !== undefined || body.agent_recommendation !== undefined
        ? parseNullableString(body.agentRecommendation ?? body.agent_recommendation) ?? null
        : undefined,
  })

  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, changeRequest })
}
