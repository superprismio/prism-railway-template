import { NextResponse } from "next/server"
import {
  createWorkflowEvent,
  getChangeRequest,
  getWorkflowRunForRequest,
  listRequestExternalRefs,
  upsertRequestExternalRef,
} from "@/lib/app-core"
import { parseString, readOptionalInteger, requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

function parseRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id: requestId } = await context.params
  if (!getChangeRequest(requestId)) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const url = new URL(request.url)
  const rawLimit = readOptionalInteger(url.searchParams.get("limit")) ?? 100
  const limit = Math.min(500, Math.max(1, rawLimit))
  return NextResponse.json({ ok: true, externalRefs: listRequestExternalRefs(requestId, limit) })
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

  const { id: requestId } = await context.params
  if (!getChangeRequest(requestId)) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const body = parseRecord(payload)
  try {
    const externalRef = upsertRequestExternalRef({
      requestId,
      provider: parseString(body.provider),
      kind: parseString(body.kind),
      externalId: parseString(body.externalId ?? body.external_id) || null,
      title: parseString(body.title) || null,
      url: parseString(body.url),
      state: parseString(body.state) || null,
      metadata: parseRecord(body.metadata),
      createdBy: parseString(body.createdBy ?? body.created_by) || "agent",
    })

    const workflowRun = getWorkflowRunForRequest(requestId)
    if (workflowRun) {
      createWorkflowEvent({
        workflowRunId: workflowRun.id,
        requestId,
        stepKey: workflowRun.currentStepKey,
        eventType: "external_ref.upserted",
        actorType: "agent",
        payload: {
          externalRefId: externalRef.id,
          provider: externalRef.provider,
          kind: externalRef.kind,
          externalId: externalRef.externalId,
          url: externalRef.url,
        },
      })
    }

    return NextResponse.json({ ok: true, externalRef }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.startsWith("EXTERNAL_REF_") ? 400 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
