import { NextResponse } from "next/server"
import {
  createAuditLog,
  createWorkflowEvent,
  getChangeRequest,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listChangeRequestExecutions,
  updateChangeRequest,
  updateWorkflowRun,
} from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import {
  hasActiveExecutionStatus,
  parseNullableString,
  readRouteParam,
  requireLocalAdminAccess,
  trackedChangeRequestPriorities,
  trackedChangeRequestStatuses,
  useLocalAppApi,
} from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  let payload: unknown = null

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const { id } = await context.params

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    const changeRequestId = readRouteParam(id)
    const existingChangeRequest = getChangeRequest(changeRequestId)
    if (!existingChangeRequest) {
      return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
    }

    const body = payload as Record<string, unknown>
    const nextStatus = typeof body.status === "string" ? body.status : undefined
    const nextPriority = typeof body.priority === "string" ? body.priority : undefined
    const nextWorkflowStepKey =
      typeof (body.currentWorkflowStepKey ?? body.current_workflow_step_key) === "string"
        ? String(body.currentWorkflowStepKey ?? body.current_workflow_step_key).trim()
        : undefined

    if (
      (nextStatus && !trackedChangeRequestStatuses.includes(nextStatus as typeof trackedChangeRequestStatuses[number])) ||
      (nextPriority && !trackedChangeRequestPriorities.includes(nextPriority as typeof trackedChangeRequestPriorities[number]))
    ) {
      return NextResponse.json({ ok: false, error: "Invalid status or priority" }, { status: 400 })
    }

    if (
      nextStatus &&
      nextStatus !== existingChangeRequest.status &&
      listChangeRequestExecutions(changeRequestId).some((execution) => hasActiveExecutionStatus(execution.status))
    ) {
      return NextResponse.json({ ok: false, error: "CHANGE_REQUEST_EXECUTION_ALREADY_RUNNING" }, { status: 409 })
    }
    if (nextWorkflowStepKey) {
      const workflow = getWorkflowByKey(existingChangeRequest.workflowKey)
      const steps = Array.isArray(workflow?.definition.steps) ? workflow.definition.steps : []
      const validStep = steps.some((step) => {
        return Boolean(step) && typeof step === "object" && !Array.isArray(step) && step.key === nextWorkflowStepKey
      })
      if (!validStep) {
        return NextResponse.json({ ok: false, error: "Invalid workflow step" }, { status: 400 })
      }
    }

    const changeRequest = updateChangeRequest(changeRequestId, {
      status: nextStatus,
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
      const workflowRun = getWorkflowRunForRequest(changeRequestId)
      const previousStepKey = workflowRun?.currentStepKey ?? null
      const updatedRun = updateWorkflowRun({
        requestId: changeRequestId,
        currentStepKey: nextWorkflowStepKey,
        status: ["approved", "rejected", "closed"].includes(changeRequest.status) ? "completed" : "active",
        completedAt: ["approved", "rejected", "closed"].includes(changeRequest.status) ? new Date().toISOString() : null,
      })
      if (updatedRun && previousStepKey !== nextWorkflowStepKey) {
        createWorkflowEvent({
          workflowRunId: updatedRun.id,
          requestId: changeRequestId,
          stepKey: nextWorkflowStepKey,
          eventType: "workflow.step_changed",
          actorType: "admin",
          payload: {
            status: changeRequest.status,
            previousStepKey,
            nextStepKey: nextWorkflowStepKey,
          },
        })
      }
    }

    createAuditLog({
      actorUserId: null,
      actionType: "admin.change_board_request.update",
      targetType: "change_request",
      targetId: changeRequest.id,
      meta: {
        status: changeRequest.status,
        priority: changeRequest.priority,
        targetEnvironmentId: changeRequest.targetEnvironmentId,
      },
    })

    return NextResponse.json({ ok: true, changeRequest })
  }

  const response = await adminFetch(`/api/admin/change-board/requests/${id}`, {
    method: "PATCH",
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

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params

  if (useLocalAppApi()) {
    const access = await requireLocalAdminAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    const changeRequest = getChangeRequest(readRouteParam(id))
    if (!changeRequest) {
      return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, changeRequest })
  }

  const response = await adminFetch(`/api/admin/change-board/requests/${id}`)
  const text = await response.text()
  const contentType = response.headers.get("content-type") ?? "application/json"

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  })
}
