import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  createWorkflowEvent,
  ensureWorkflowRunForRequest,
  getChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listChangeRequestExecutions,
  updateChangeRequest,
  updateWorkflowRun,
} from "@/lib/app-core"

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

function isWorkflowStep(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { key?: unknown }).key === "string"
}

function statusForWorkflowStep(step: Record<string, unknown> | null | undefined) {
  const statuses = Array.isArray(step?.statusMap)
    ? step.statusMap.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
  if (!statuses.length) {
    return null
  }
  if (step?.type === "agent") {
    return statuses.find((status) => status === "triaging" || status === "in-progress") ?? statuses[0]
  }
  return statuses[0]
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

  const targetApp = changeRequest.targetAppId ? getTargetApp(changeRequest.targetAppId) : null
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
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }
  const body = payload as Record<string, unknown>
  const nextStatus = typeof body.status === "string" ? body.status : undefined
  const nextPriority = typeof body.priority === "string" ? body.priority : undefined
  const rawWorkflowStepKey = body.currentWorkflowStepKey ?? body.current_workflow_step_key
  const nextWorkflowStepKey =
    typeof rawWorkflowStepKey === "string"
      ? rawWorkflowStepKey.trim()
      : undefined
  if (rawWorkflowStepKey !== undefined && nextWorkflowStepKey === "") {
    return NextResponse.json({ ok: false, error: "Invalid workflow step" }, { status: 400 })
  }

  if (!existingChangeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const workflow = nextWorkflowStepKey ? getWorkflowByKey(existingChangeRequest.workflowKey) : null
  const workflowSteps = Array.isArray(workflow?.definition.steps) ? workflow.definition.steps.filter(isWorkflowStep) : []
  const nextWorkflowStep = nextWorkflowStepKey
    ? workflowSteps.find((step) => step.key === nextWorkflowStepKey) ?? null
    : null
  const derivedStatus = nextWorkflowStep ? statusForWorkflowStep(nextWorkflowStep) : null
  const projectedStatus = nextStatus ?? derivedStatus ?? undefined

  if (projectedStatus && !trackedChangeRequestStatuses.includes(projectedStatus as typeof trackedChangeRequestStatuses[number])) {
    return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 })
  }
  if (nextPriority && !trackedChangeRequestPriorities.includes(nextPriority as typeof trackedChangeRequestPriorities[number])) {
    return NextResponse.json({ ok: false, error: "Invalid priority" }, { status: 400 })
  }
  if (!nextWorkflowStepKey && projectedStatus && isTriageOnlyStatus(existingChangeRequest.status) && isExecutionStatus(projectedStatus)) {
    return NextResponse.json({ ok: false, error: "CHANGE_REQUEST_NOT_READY_FOR_EXECUTION" }, { status: 409 })
  }
  if (nextWorkflowStepKey) {
    if (!nextWorkflowStep) {
      return NextResponse.json({ ok: false, error: "Invalid workflow step" }, { status: 400 })
    }
  }

  const changeRequest = updateChangeRequest(changeRequestId, {
    status: projectedStatus,
    workflowStepKey: nextWorkflowStepKey,
    priority: nextPriority,
    syncWorkflowRun: !nextWorkflowStepKey,
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
  if (nextWorkflowStepKey) {
    const workflowRun = getWorkflowRunForRequest(changeRequestId) ?? ensureWorkflowRunForRequest({
      requestId: changeRequestId,
      workflowKey: changeRequest.workflowKey,
      status: changeRequest.status,
      currentStepKey: nextWorkflowStepKey,
    })
    const previousStepKey = workflowRun?.currentStepKey ?? null
    const isTerminalWorkflowStep = nextWorkflowStep?.type === "terminal"
    const updatedRun = updateWorkflowRun({
      requestId: changeRequestId,
      currentStepKey: nextWorkflowStepKey,
      status: isTerminalWorkflowStep ? "completed" : "active",
      completedAt: isTerminalWorkflowStep ? new Date().toISOString() : null,
    })
    if (updatedRun && previousStepKey !== nextWorkflowStepKey) {
      createWorkflowEvent({
        workflowRunId: updatedRun.id,
        requestId: changeRequestId,
        stepKey: nextWorkflowStepKey,
        eventType: "workflow.step_changed",
        actorType: "system",
        payload: {
          status: changeRequest.status,
          previousStepKey,
          nextStepKey: nextWorkflowStepKey,
        },
      })
    }
  }

  return NextResponse.json({ ok: true, changeRequest })
}
