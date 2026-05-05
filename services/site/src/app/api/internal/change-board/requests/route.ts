import { NextResponse } from "next/server"
import { createChangeRequest, getDefaultTargetEnvironmentForApp, getWorkflowByKey } from "@/lib/app-core"

import {
  parseNullableString,
  parseString,
  requireServiceAccess,
} from "@/lib/internal-service"
import { trackedChangeRequestPriorities, trackedChangeRequestStatuses, trackedChangeRequestTypes } from "@/lib/local-admin-api"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
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
  const title = parseString(body.title)
  const description = parseString(body.description)
  const requestType = parseString(body.requestType ?? body.request_type)
  const targetAppId = parseString(body.targetAppId ?? body.target_app_id)
  const workflowKey = parseString(body.workflowKey ?? body.workflow_key) || "change-request-default"
  const status = parseString(body.status) || "submitted"
  const priority = parseString(body.priority) || "normal"
  const workflow = getWorkflowByKey(workflowKey)
  const target = workflow?.definition?.target
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
  if (targetRequired && !targetAppId) {
    return NextResponse.json({ ok: false, error: `Workflow ${workflowKey} requires targetAppId` }, { status: 400 })
  }
  if (!trackedChangeRequestTypes.includes(requestType as typeof trackedChangeRequestTypes[number])) {
    return NextResponse.json({ ok: false, error: "Invalid request type" }, { status: 400 })
  }
  if (!trackedChangeRequestStatuses.includes(status as typeof trackedChangeRequestStatuses[number])) {
    return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 })
  }
  if (!trackedChangeRequestPriorities.includes(priority as typeof trackedChangeRequestPriorities[number])) {
    return NextResponse.json({ ok: false, error: "Invalid priority" }, { status: 400 })
  }

  const changeRequest = createChangeRequest({
    title,
    description,
    workflowKey,
    requestType,
    status,
    priority,
    source: parseString(body.source) || "chat",
    requestedByUserId: null,
    targetAppId: targetAppId || null,
    targetEnvironmentId:
      targetAppId
        ? parseNullableString(body.targetEnvironmentId ?? body.target_environment_id)
          ?? getDefaultTargetEnvironmentForApp(targetAppId)?.id
          ?? null
        : null,
    triageSummary: parseNullableString(body.triageSummary ?? body.triage_summary) ?? null,
    acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria : [],
    constraints: body.constraints && typeof body.constraints === "object" && !Array.isArray(body.constraints) ? body.constraints as Record<string, unknown> : {},
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    agentRecommendation: parseNullableString(body.agentRecommendation ?? body.agent_recommendation) ?? null,
  })

  return NextResponse.json({ ok: true, changeRequest }, { status: 201 })
}
