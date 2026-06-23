import { NextResponse } from "next/server"
import {
  cancelActiveAgentRunsForRequest,
  createAgentMessage,
  createAgentSession,
  createWorkflowEvent,
  findLatestAgentSessionByChangeRequest,
  getChangeRequest,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listAgentMessages,
  updateAgentSession,
  updateChangeRequest,
  updateWorkflowRun,
} from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { parseString, readRouteParam, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"
import { wakeWorkflowAgentRunDispatcher } from "@/lib/workflow-agent-run-queue"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params
  const rawBody = await request.text().catch(() => "")

  if (!useLocalAppApi()) {
    const response = await adminFetch(
      `/api/admin/change-board/requests/${id}/workflow/cancel`,
      {
        method: "POST",
        body: rawBody || undefined,
        headers: rawBody
          ? { "content-type": request.headers.get("content-type") ?? "application/json" }
          : undefined,
      },
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

  let payload: unknown = null
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
    }
  }

  const body =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const operatorNote =
    parseString(body.comment ?? body.note) || "Canceled by an admin operator."

  const changeRequestId = readRouteParam(id)
  const changeRequest = getChangeRequest(changeRequestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
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

  const canceledAgentRuns = cancelActiveAgentRunsForRequest({
    requestId: changeRequest.id,
    reason: operatorNote,
  })
  wakeWorkflowAgentRunDispatcher()
  const workflowRun = getWorkflowRunForRequest(changeRequest.id)
  updateChangeRequest(changeRequest.id, {
    workflowStepKey: terminalStepKey,
    resolutionSummary: operatorNote,
  })
  if (workflowRun) {
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
      eventType: "workflow.canceled",
      actorType: "admin",
      note: operatorNote,
      payload: {
        canceledAgentRunIds: canceledAgentRuns.map((run) => run.id),
        previousStepKey: workflowRun.currentStepKey,
        terminalStepKey,
        comment: operatorNote,
      },
    })
  }

  let messages = null
  if (operatorNote) {
    let session = findLatestAgentSessionByChangeRequest(changeRequest.id)
    if (!session) {
      session = createAgentSession({
        source: "admin-console",
        status: "active",
        title: changeRequest.title,
        linkedChangeRequestId: changeRequest.id,
        linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
        createdByUserId: null,
        meta: { transport: "site" },
        lastMessageAt: new Date().toISOString(),
      })
    }

    if (session) {
      createAgentMessage({
        sessionId: session.id,
        role: "user",
        source: "site-comment",
        sourceMessageId: null,
        content: operatorNote,
        meta: {
          transport: "site",
          kind: "comment",
          workflowCanceled: true,
        },
      })
      updateAgentSession(session.id, {
        linkedChangeRequestId: changeRequest.id,
        linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
        lastMessageAt: new Date().toISOString(),
        meta: {
          ...session.meta,
          transport: "site",
        },
      })
      messages = listAgentMessages(session.id, 100)
    }
  }

  return NextResponse.json({
    ok: true,
    canceledAgentRuns,
    changeRequest: getChangeRequest(changeRequest.id) ?? changeRequest,
    workflowRun: getWorkflowRunForRequest(changeRequest.id),
    messages,
  })
}
