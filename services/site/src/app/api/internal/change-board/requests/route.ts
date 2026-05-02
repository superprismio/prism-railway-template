import { NextResponse } from "next/server"
import { createChangeRequest, getDefaultTargetEnvironmentForApp } from "@/lib/app-core"

import {
  parseNullableString,
  parseString,
  requireServiceAccess,
} from "@/lib/internal-service"
import { trackedChangeRequestPriorities, trackedChangeRequestStatuses, trackedChangeRequestTypes } from "@/lib/local-admin-api"

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
  const status = parseString(body.status) || "submitted"
  const priority = parseString(body.priority) || "normal"

  if (!title || !description || !requestType || !targetAppId) {
    return NextResponse.json({ ok: false, error: "title, description, requestType, and targetAppId are required" }, { status: 400 })
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
    workflowKey: parseString(body.workflowKey ?? body.workflow_key) || "change-request-default",
    requestType,
    status,
    priority,
    source: parseString(body.source) || "chat",
    requestedByUserId: null,
    targetAppId,
    targetEnvironmentId:
      parseNullableString(body.targetEnvironmentId ?? body.target_environment_id)
      ?? getDefaultTargetEnvironmentForApp(targetAppId)?.id
      ?? null,
    triageSummary: parseNullableString(body.triageSummary ?? body.triage_summary) ?? null,
    acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria : [],
    constraints: body.constraints && typeof body.constraints === "object" && !Array.isArray(body.constraints) ? body.constraints as Record<string, unknown> : {},
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    agentRecommendation: parseNullableString(body.agentRecommendation ?? body.agent_recommendation) ?? null,
  })

  return NextResponse.json({ ok: true, changeRequest }, { status: 201 })
}
