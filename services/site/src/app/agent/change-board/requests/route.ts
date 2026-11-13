import { NextResponse } from "next/server"
import { createChangeRequest, getChangeRequest, getDefaultTargetEnvironmentForApp, getTargetApp, getWorkflowByKey, listChangeRequests } from "@/lib/app-core"

import {
  parseNullableString,
  parseString,
  requireServiceAccess,
  requireTaskRunnerMutationAccess,
} from "@/lib/internal-service"
import { verifyRequestCreationContext } from "@/lib/request-creation-context"
import { trackedChangeRequestPriorities, trackedChangeRequestTypes } from "@/lib/local-admin-api"
import { parseEstimatedHumanHours } from "@/lib/request-estimates"
import { publicUrlFromRequest } from "@/lib/public-url"
import { selectedRequestWorkspaceId } from "@/lib/prism-lab/request-links"
import { autoStartWorkflowRequest } from "@/lib/workflow-autostart"
import { requireRequestWorkflowKey, workflowSelectionHint } from "@/lib/request-workflow-selection"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readPositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

function readBooleanQuery(value: string | null) {
  return value ? new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase()) : false
}

function readBooleanBody(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase())
  return fallback
}

export async function GET(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const targetAppId = parseString(url.searchParams.get("targetAppId") ?? url.searchParams.get("target_app_id")) || undefined
  const source = parseString(url.searchParams.get("source")) || undefined
  const platform = parseString(url.searchParams.get("platform")) || undefined
  const originTargetId = parseString(url.searchParams.get("target")) || undefined
  const interactionProfileKey = parseString(url.searchParams.get("profile")) || undefined
  const originActor = parseString(url.searchParams.get("initiator")) || undefined
  const creatorId = parseString(url.searchParams.get("creator")) || undefined
  const sourceSessionId = parseString(url.searchParams.get("sourceSessionId")) || undefined
  const sourceMessageId = parseString(url.searchParams.get("sourceMessageId")) || undefined
  if (sourceMessageId && !sourceSessionId) {
    return NextResponse.json({ ok: false, error: "SOURCE_SESSION_REQUIRED" }, { status: 400 })
  }
  const query = parseString(url.searchParams.get("q")) || undefined
  const openOnly = readBooleanQuery(url.searchParams.get("openOnly") ?? url.searchParams.get("open_only"))
  const limit = Math.min(readPositiveInteger(url.searchParams.get("limit"), 100), 500)
  const changeRequests = listChangeRequests({ targetAppId, source, platform, originTargetId, interactionProfileKey, originActor, creatorId, sourceSessionId, sourceMessageId, query, openOnly, limit })

  return NextResponse.json({
    ok: true,
    changeRequests: sourceSessionId && sourceMessageId
      ? changeRequests.map((item) => ({
        ...item,
        requestUrl: publicUrlFromRequest(request, `/admin/lab/requests/${item.requestNumber}#${selectedRequestWorkspaceId}`),
      }))
      : changeRequests,
  })
}

export async function POST(request: Request) {
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

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const source = parseString(body.source) || "chat"
  const isTask = source.startsWith("task:")
  const taskKey = isTask ? source.slice(5) : null
  const isDoctor = source === "prism-doctor"
  const creationContext = verifyRequestCreationContext(request.headers.get("x-prism-request-creation-context"))
  let creator: { type: "user" | "agent" | "automation"; id: string; displayName: string | null; basis: string; agentRunId?: string | null; parentRequestId?: string | null; sourceMessageRecordId?: string | null }
  if (isTask || isDoctor) {
    const taskAccess = await requireTaskRunnerMutationAccess()
    if (!taskAccess.ok) return NextResponse.json({ ok: false, error: taskAccess.error }, { status: taskAccess.status })
    if (creationContext) return NextResponse.json({ ok: false, error: "REQUEST_CREATOR_CONFLICT" }, { status: 400 })
    if (isTask) {
      if (!taskKey) return NextResponse.json({ ok: false, error: "REQUEST_TASK_NOT_FOUND" }, { status: 400 })
      // The key must name a configured task; the shared service credential alone
      // is insufficient to assert which automation created this request.
      const { getDb } = await import("@/lib/app-core/db")
      const task = getDb().prepare("SELECT key, name FROM tasks WHERE key = ?").get(taskKey) as { key: string; name: string } | undefined
      if (!task) return NextResponse.json({ ok: false, error: "REQUEST_TASK_NOT_FOUND" }, { status: 400 })
      creator = { type: "automation", id: `task:${task.key}`, displayName: task.name, basis: "authenticated-task-runner" }
    } else {
      creator = { type: "automation", id: "prism-doctor", displayName: "Prism Doctor", basis: "authenticated-task-runner" }
    }
  } else {
    if (!creationContext) return NextResponse.json({
      ok: false,
      error: "REQUEST_CREATOR_REQUIRED",
      hint: "Send x-prism-request-creation-context using PRISM_REQUEST_CREATION_CONTEXT from the current Runtime job; sourceSessionId/sourceMessageId alone are insufficient.",
    }, { status: 400 })
    const sourceSessionId = parseNullableString(body.sourceSessionId ?? body.source_session_id)
    const sourceMessageId = parseNullableString(body.sourceMessageId ?? body.source_message_id)
    if ((sourceSessionId && sourceSessionId !== creationContext.sourceSessionId)
      || (sourceMessageId && sourceMessageId !== creationContext.sourceMessageId)) {
      return NextResponse.json({ ok: false, error: "REQUEST_CREATOR_CONFLICT" }, { status: 400 })
    }
    creator = creationContext.creator
  }
  const origin = new URL(request.url).origin
  const title = parseString(body.title)
  const description = parseString(body.description)
  const requestType = parseString(body.requestType ?? body.request_type)
  const targetAppId = parseString(body.targetAppId ?? body.target_app_id)
  let workflowKey: string
  try {
    workflowKey = requireRequestWorkflowKey(body.workflowKey ?? body.workflow_key)
  } catch {
    return NextResponse.json({ ok: false, error: "WORKFLOW_KEY_REQUIRED", hint: workflowSelectionHint }, { status: 400 })
  }
  const priority = parseString(body.priority) || "normal"
  const hasEstimatedHumanHours = body.estimatedHumanHours !== undefined || body.estimated_human_hours !== undefined
  const estimatedHumanHours = parseEstimatedHumanHours(body.estimatedHumanHours ?? body.estimated_human_hours)
  const workflow = getWorkflowByKey(workflowKey)
  const target = workflow?.definition?.target
  const allowTargetless = readBooleanBody(body.allowTargetless ?? body.allow_targetless)
  const isTargetlessRequest = allowTargetless && !targetAppId
  const targetRequired = workflowKey === "change-request-default"
    || (isRecord(target) && target.required === true)

  if (!title || !description || !requestType) {
    return NextResponse.json({ ok: false, error: "title, description, and requestType are required" }, { status: 400 })
  }
  if (!workflow) {
    return NextResponse.json({ ok: false, error: `Workflow not found: ${workflowKey}` }, { status: 400 })
  }
  if (!workflow.enabled) {
    return NextResponse.json({ ok: false, error: `Workflow disabled: ${workflowKey}` }, { status: 400 })
  }
  if (targetRequired && !targetAppId && !allowTargetless) {
    return NextResponse.json({ ok: false, error: `Workflow ${workflowKey} requires targetAppId` }, { status: 400 })
  }
  const targetApp = targetAppId ? getTargetApp(targetAppId) : null
  if (targetAppId && (!targetApp || !targetApp.agentEnabled)) {
    return NextResponse.json({ ok: false, error: "Target app is inactive or unavailable" }, { status: 400 })
  }
  if (!trackedChangeRequestTypes.includes(requestType as typeof trackedChangeRequestTypes[number])) {
    return NextResponse.json({
      ok: false,
      error: "Invalid request type",
      validRequestTypes: trackedChangeRequestTypes,
    }, { status: 400 })
  }
  if (!trackedChangeRequestPriorities.includes(priority as typeof trackedChangeRequestPriorities[number])) {
    return NextResponse.json({
      ok: false,
      error: "Invalid priority",
      validPriorities: trackedChangeRequestPriorities,
    }, { status: 400 })
  }
  if (hasEstimatedHumanHours && estimatedHumanHours === undefined) {
    return NextResponse.json({ ok: false, error: "Invalid estimatedHumanHours" }, { status: 400 })
  }

  let changeRequest
  try {
    changeRequest = createChangeRequest({
    title,
    description,
    workflowKey,
    requestType,
    priority,
    source,
    requestedByUserId: null,
    creator,
    sourceSessionId: creationContext?.sourceSessionId ?? null,
    sourceMessageId: creationContext?.sourceMessageId ?? null,
    targetAppId: targetAppId || null,
    targetEnvironmentId:
      targetAppId
        ? parseNullableString(body.targetEnvironmentId ?? body.target_environment_id)
          ?? getDefaultTargetEnvironmentForApp(targetAppId)?.id
          ?? null
        : null,
    triageSummary: parseNullableString(body.triageSummary ?? body.triage_summary) ?? null,
    estimatedHumanHours: estimatedHumanHours ?? null,
    acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria : [],
    constraints: body.constraints && typeof body.constraints === "object" && !Array.isArray(body.constraints) ? body.constraints as Record<string, unknown> : {},
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    agentRecommendation: parseNullableString(body.agentRecommendation ?? body.agent_recommendation) ?? null,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "SOURCE_SESSION_NOT_FOUND" || code === "SOURCE_SESSION_REQUIRED" || code === "SOURCE_MESSAGE_NOT_FOUND") {
      return NextResponse.json({ ok: false, error: code }, { status: 400 })
    }
    throw error
  }

  const autoStartRequested = !isTargetlessRequest && body.autoStart !== false && body.auto_start !== false
  const rawRequestedSkills = body.requestedSkills ?? body.requested_skills
  const requestedSkills = Array.isArray(rawRequestedSkills)
    ? rawRequestedSkills
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item: string) => item.trim())
    : []
  const autoStart = changeRequest && autoStartRequested
    ? await autoStartWorkflowRequest(changeRequest, { baseUrl: origin, requestedSkills })
    : null
  const refreshedChangeRequest = changeRequest ? getChangeRequest(changeRequest.id) : null

  return NextResponse.json({
    ok: true,
    changeRequest: refreshedChangeRequest ?? changeRequest,
    autoStart,
  }, { status: 201 })
}
