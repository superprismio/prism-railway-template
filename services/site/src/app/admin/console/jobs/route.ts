import { NextResponse } from "next/server"

import {
  createAgentResponseJob,
  createAgentSession,
  getAgentResponseJob,
  getAgentSession,
  updateAgentResponseJob,
} from "@/lib/app-core"
import { requireLocalAdminAccess } from "@/lib/local-admin-api"
import { handleResponsePost } from "@/lib/response-route-handler"

type ResponseInputMessage = {
  role?: unknown
  content?: unknown
}

function parseInputMessages(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((entry): entry is ResponseInputMessage => !!entry && typeof entry === "object")
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role : "user",
      content: typeof entry.content === "string" ? entry.content.trim() : "",
    }))
    .filter((entry) => entry.content)
}

function traceFromPayload(payload: Record<string, unknown>) {
  const metadata = payload.metadata
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const trace = (metadata as Record<string, unknown>).trace
    if (Array.isArray(trace)) {
      return trace.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    }
  }
  return []
}

async function runConsoleJob(jobId: string, requestUrl: string) {
  const job = createJobSnapshot(jobId)
  if (!job) return

  const startedAt = new Date().toISOString()
  updateAgentResponseJob(jobId, {
    status: "running",
    startedAt,
  })

  try {
    const response = await handleResponsePost(
      new Request(new URL("/admin/responses", requestUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job.input),
      }),
      async () => ({ ok: true as const }),
    )
    const text = await response.text()
    const parsedPayload = text ? JSON.parse(text) : {}
    const payload =
      parsedPayload && typeof parsedPayload === "object" && !Array.isArray(parsedPayload)
        ? parsedPayload as Record<string, unknown>
        : { output_text: String(parsedPayload ?? "") }
    const outputText = typeof payload.output_text === "string" ? payload.output_text : null
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : job.sessionId
    const trace = traceFromPayload(payload)

    updateAgentResponseJob(jobId, {
      sessionId,
      status: response.ok ? "succeeded" : "failed",
      response: payload,
      outputText,
      errorMessage: response.ok ? null : typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`,
      trace,
      finishedAt: new Date().toISOString(),
    })
  } catch (error) {
    updateAgentResponseJob(jobId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "CONSOLE_JOB_FAILED",
      finishedAt: new Date().toISOString(),
    })
  }
}

function createJobSnapshot(jobId: string) {
  return getAgentResponseJob(jobId)
}

export async function POST(request: Request) {
  const access = await requireLocalAdminAccess()
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
  const inputMessages = parseInputMessages(body.input)
  const latestUserMessage = [...inputMessages].reverse().find((entry) => entry.role === "user") ?? null
  if (!latestUserMessage) {
    return NextResponse.json(
      { ok: false, error: "input must include at least one user message" },
      { status: 400 },
    )
  }

  const requestedSessionId =
    typeof (body.session_id ?? body.sessionId) === "string"
      ? String(body.session_id ?? body.sessionId).trim()
      : ""
  let session = requestedSessionId ? getAgentSession(requestedSessionId) : null
  if (requestedSessionId && (!session || session.source !== "admin-console")) {
    return NextResponse.json({ ok: false, error: "Agent session not found" }, { status: 404 })
  }
  if (!session) {
    session = createAgentSession({
      source: "admin-console",
      status: "active",
      title: latestUserMessage.content.slice(0, 80),
      linkedChangeRequestId:
        typeof body.linked_change_request_id === "string"
          ? body.linked_change_request_id
          : typeof body.linkedChangeRequestId === "string"
            ? body.linkedChangeRequestId
            : null,
      linkedTargetEnvironmentId:
        typeof body.linked_target_environment_id === "string"
          ? body.linked_target_environment_id
          : typeof body.linkedTargetEnvironmentId === "string"
            ? body.linkedTargetEnvironmentId
            : null,
      createdByUserId: null,
      meta: { transport: "site" },
      lastMessageAt: new Date().toISOString(),
    })
  }
  if (!session) {
    return NextResponse.json({ ok: false, error: "AGENT_SESSION_CREATE_FAILED" }, { status: 500 })
  }

  const input = {
    ...body,
    session_id: session.id,
  }
  const job = createAgentResponseJob({
    sessionId: session.id,
    input,
  })
  if (!job) {
    return NextResponse.json({ ok: false, error: "CONSOLE_JOB_CREATE_FAILED" }, { status: 500 })
  }

  void runConsoleJob(job.id, request.url)

  return NextResponse.json(
    {
      ok: true,
      job,
      jobId: job.id,
      session_id: session.id,
    },
    { status: 202 },
  )
}
