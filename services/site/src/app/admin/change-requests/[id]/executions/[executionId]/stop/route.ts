import { NextResponse } from "next/server"
import {
  createWorkflowEvent,
  getChangeRequest,
  getChangeRequestExecution,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  updateChangeRequest,
  updateChangeRequestExecution,
  updateWorkflowRun,
} from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { readRouteParam, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"

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

  const changeRequestId = readRouteParam(id)
  const execution = getChangeRequestExecution(readRouteParam(executionId))
  if (!execution || execution.changeRequestId !== changeRequestId) {
    return NextResponse.json({ ok: false, error: "Execution not found" }, { status: 404 })
  }

  const changeRequest = getChangeRequest(changeRequestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  if (execution.status !== "running") {
    return NextResponse.json({ ok: false, error: "Execution is not running" }, { status: 409 })
  }

  const now = new Date().toISOString()
  const workflow = getWorkflowByKey(changeRequest.workflowKey)
  const workflowSteps = Array.isArray(workflow?.definition.steps)
    ? workflow.definition.steps.filter(
        (step): step is Record<string, unknown> =>
          Boolean(step) &&
          typeof step === "object" &&
          !Array.isArray(step) &&
          typeof (step as { key?: unknown }).key === "string",
      )
    : []
  const terminalStep = workflowSteps.find((step) => step.type === "terminal")
  const terminalStepKey =
    typeof terminalStep?.key === "string" && terminalStep.key.trim()
      ? terminalStep.key
      : "closed"
  const stoppedExecution = updateChangeRequestExecution(execution.id, {
    status: "canceled",
    summary: "Canceled by an admin operator.",
    errorMessage: null,
    finishedAt: now,
    meta: {
      cancelRequested: true,
      canceledAt: now,
      canceledBy: "admin",
      terminalStepKey,
    },
  })

  const workflowRun = getWorkflowRunForRequest(changeRequest.id)
  if (workflowRun) {
    updateChangeRequest(changeRequest.id, {
      workflowStepKey: terminalStepKey,
      resolutionSummary: "Canceled by an admin operator.",
    })
    updateWorkflowRun({
      requestId: changeRequest.id,
      currentStepKey: terminalStepKey,
      status: "canceled",
      completedAt: now,
    })
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId: changeRequest.id,
      stepKey: terminalStepKey,
      eventType: "agent.canceled",
      actorType: "admin",
      note: "Canceled the active agent execution and moved the workflow to a terminal step.",
      payload: {
        executionId: execution.id,
        previousStepKey: workflowRun.currentStepKey,
        terminalStepKey,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    execution: stoppedExecution,
    changeRequest: getChangeRequest(changeRequest.id) ?? changeRequest,
    workflowRun: getWorkflowRunForRequest(changeRequest.id),
  })
}
