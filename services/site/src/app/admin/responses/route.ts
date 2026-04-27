import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  createAgentMessage,
  createAgentSession,
  createChangeRequestExecution,
  getAgentSession,
  getChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  listAgentMessages,
  listChangeRequestExecutions,
  loadConfig,
  updateAgentSession,
  updateChangeRequest,
  updateChangeRequestExecution,
} from "@prism-railway/app-core"

import { adminFetch } from "@/lib/admin"
import { parseNullableString, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"

type ResponseInputMessage = {
  role: string
  content: string
}

type RuntimeTraceEntry = {
  at: string
  kind: string
  message: string
}

type RuntimeResponsePayload = {
  ok?: boolean
  error?: string
  id?: string | null
  model?: string | null
  provider?: string | null
  responseText?: string
  output_text?: string
  thread_id?: string | null
  branchName?: string | null
  commitSha?: string | null
  branchUrl?: string | null
  baseBranch?: string | null
  baseCommitSha?: string | null
  trace?: Array<{ at?: string; kind?: string; message?: string }>
}

type RuntimeError = Error & {
  codexThreadId?: string | null
  branchName?: string | null
  commitSha?: string | null
  baseBranch?: string | null
  baseCommitSha?: string | null
  trace?: RuntimeTraceEntry[]
}

function parseResponseInputMessages(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as ResponseInputMessage[]
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null
      }

      const candidate = entry as {
        role?: unknown
        content?: unknown
      }

      if (typeof candidate.content === "string" && candidate.content.trim()) {
        return {
          role: typeof candidate.role === "string" ? candidate.role.trim() || "user" : "user",
          content: candidate.content.trim(),
        }
      }

      if (Array.isArray(candidate.content)) {
        const joined = candidate.content
          .flatMap((part) => {
            if (!part || typeof part !== "object") return []
            const contentPart = part as { text?: unknown }
            return typeof contentPart.text === "string" && contentPart.text.trim() ? [contentPart.text.trim()] : []
          })
          .join("\n\n")
          .trim()

        if (joined) {
          return {
            role: typeof candidate.role === "string" ? candidate.role.trim() || "user" : "user",
            content: joined,
          }
        }
      }

      return null
    })
    .filter((entry): entry is ResponseInputMessage => Boolean(entry))
}

function getLinkedChangeRequestPhase(status: string | null | undefined) {
  if (!status) {
    return null
  }

  if (["submitted", "triaging", "needs-human-input"].includes(status)) {
    return "triage" as const
  }

  if (["ready-for-agent", "in-progress", "awaiting-review", "changes-requested"].includes(status)) {
    return "execution" as const
  }

  return null
}

function getRunningStatusForPhase(phase: "triage" | "execution") {
  return phase === "triage" ? "triaging" : "in-progress"
}

function getCompletedStatusForPhase(phase: "triage" | "execution") {
  return phase === "triage" ? "ready-for-agent" : "awaiting-review"
}

function hasActiveExecution(changeRequestId: string, excludeExecutionId?: string | null) {
  return listChangeRequestExecutions(changeRequestId).some((execution) => {
    if (excludeExecutionId && execution.id === excludeExecutionId) {
      return false
    }

    return ["planned", "running"].includes(execution.status)
  })
}

function getPhaseInstruction(phase: "triage" | "execution" | null) {
  if (phase === "triage") {
    return "This request is currently in triage. Use this turn only to analyze scope, write triage details, and stop after moving it to ready-for-agent. Do not start implementation, deploy work, or execution in this same turn."
  }

  if (phase === "execution") {
    return "This request is already approved for agent work. Treat recent user comments as execution instructions and report what changed, what is blocked, and what should happen next."
  }

  return null
}

function formatTraceSummary(trace: RuntimeTraceEntry[] | undefined) {
  if (!Array.isArray(trace) || !trace.length) {
    return null
  }

  return trace
    .slice(-8)
    .map((entry) => `[${entry.at}] ${entry.kind}: ${entry.message}`)
    .join("\n")
}

function summarizeGitPushState(trace: RuntimeTraceEntry[] | undefined) {
  if (!Array.isArray(trace) || !trace.length) {
    return {
      gitPushSucceeded: null as boolean | null,
      gitPushError: null as string | null,
    }
  }

  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const entry = trace[index]
    if (!entry || typeof entry.message !== "string") {
      continue
    }

    if (entry.kind === "git.push_succeeded") {
      return {
        gitPushSucceeded: true,
        gitPushError: null,
      }
    }

    if (
      ["git.finalize_failed", "runtime.error", "stderr"].includes(entry.kind) &&
      /git push|github|username for https:\/\/github\.com/i.test(entry.message)
    ) {
      return {
        gitPushSucceeded: false,
        gitPushError: entry.message,
      }
    }
  }

  return {
    gitPushSucceeded: null,
    gitPushError: null,
  }
}

async function requestCodexRuntimeResponse(input: {
  prompt: string
  sessionId: string
  codexThreadId?: string | null
  recentHistory: Array<{ role: string; content: string }>
  metadata: Record<string, unknown>
}) {
  const config = loadConfig()
  if (!config.codexRuntimeBaseUrl) {
    throw new Error("CODEX_RUNTIME_BASE_URL_MISSING")
  }

  const response = await fetch(`${config.codexRuntimeBaseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: input.prompt,
      sessionId: input.sessionId,
      codexThreadId: input.codexThreadId ?? null,
      recentHistory: input.recentHistory,
      metadata: input.metadata,
    }),
  })

  const payload = (await response.json().catch(() => null)) as RuntimeResponsePayload | null

  if (!response.ok) {
    const error = new Error(
      `CODEX_RUNTIME_REQUEST_FAILED:${response.status}:${payload?.error || "Unknown codex runtime error"}`,
    ) as RuntimeError
    error.codexThreadId = payload?.thread_id ?? null
    error.branchName = payload?.branchName ?? null
    error.commitSha = payload?.commitSha ?? null
    error.baseBranch = payload?.baseBranch ?? null
    error.baseCommitSha = payload?.baseCommitSha ?? null
    error.trace = Array.isArray(payload?.trace)
      ? payload.trace
          .map((entry) => ({
            at: typeof entry?.at === "string" ? entry.at : new Date().toISOString(),
            kind: typeof entry?.kind === "string" ? entry.kind : "runtime",
            message: typeof entry?.message === "string" ? entry.message : "",
          }))
          .filter((entry) => entry.message.trim())
      : []
    throw error
  }

  if (!payload) {
    throw new Error("CODEX_RUNTIME_INVALID_RESPONSE")
  }

  return payload
}

export async function POST(request: Request) {
  let payload: unknown = null

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  if (!useLocalAppApi()) {
    const response = await adminFetch("/api/v1/responses", {
      method: "POST",
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

  const auth = await requireLocalAdminAccess()
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const sessionId = parseNullableString(body.session_id ?? body.sessionId) ?? null
  const linkedChangeRequestId =
    parseNullableString(body.linked_change_request_id ?? body.linkedChangeRequestId) ?? null
  const linkedTargetEnvironmentId =
    parseNullableString(body.linked_target_environment_id ?? body.linkedTargetEnvironmentId) ?? null
  const inputMessages = parseResponseInputMessages(body.input)
  const latestUserMessage = [...inputMessages].reverse().find((entry) => entry.role === "user") ?? null

  if (!latestUserMessage) {
    return NextResponse.json(
      { ok: false, error: "input must include at least one user message" },
      { status: 400 },
    )
  }

  let session = sessionId ? getAgentSession(sessionId) : null
  if (!session && sessionId) {
    return NextResponse.json({ ok: false, error: "Agent session not found" }, { status: 404 })
  }

  if (!session) {
    session = createAgentSession({
      source: "admin-console",
      status: "active",
      title: latestUserMessage.content.slice(0, 80),
      linkedChangeRequestId,
      linkedTargetEnvironmentId,
      createdByUserId: null,
      meta: {
        transport: "site",
      },
      lastMessageAt: new Date().toISOString(),
    })
  }

  if (!session) {
    return NextResponse.json({ ok: false, error: "AGENT_SESSION_CREATE_FAILED" }, { status: 500 })
  }

  const storedMessages = listAgentMessages(session.id, 100)
  const recentHistory = storedMessages.length
    ? storedMessages.slice(-12).map((entry) => ({
        role: entry.role,
        content: entry.content,
      }))
    : inputMessages.slice(0, -1)
  const activeLinkedChangeRequestId = linkedChangeRequestId ?? session.linkedChangeRequestId ?? null
  const activeLinkedTargetEnvironmentId = linkedTargetEnvironmentId ?? session.linkedTargetEnvironmentId ?? null
  const linkedChangeRequest = activeLinkedChangeRequestId ? getChangeRequest(activeLinkedChangeRequestId) : null
  const linkedTargetApp = linkedChangeRequest ? getTargetApp(linkedChangeRequest.targetAppId) : null
  const linkedTargetEnvironment = activeLinkedTargetEnvironmentId
    ? getTargetEnvironment(activeLinkedTargetEnvironmentId)
    : linkedChangeRequest?.targetEnvironmentId
      ? getTargetEnvironment(linkedChangeRequest.targetEnvironmentId)
      : null
  const linkedDeployPlan =
    linkedChangeRequest && linkedTargetApp && linkedTargetEnvironment
      ? buildTargetEnvironmentDeployPlan({
          request: linkedChangeRequest,
          targetApp: linkedTargetApp,
          targetEnvironment: linkedTargetEnvironment,
        })
      : null
  const linkedLatestExecution = activeLinkedChangeRequestId
    ? listChangeRequestExecutions(activeLinkedChangeRequestId)[0] ?? null
    : null
  const requestedSkillsInput: unknown[] = Array.isArray(body.requested_skills ?? body.requestedSkills)
    ? (body.requested_skills ?? body.requestedSkills) as unknown[]
    : []
  const requestedSkills = Array.from(
    new Set([
      ...requestedSkillsInput
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry: string) => entry.trim()),
      ...(activeLinkedChangeRequestId ? ["change-request-ops", "target-deploy-ops"] : []),
    ]),
  )

  createAgentMessage({
    sessionId: session.id,
    role: "user",
    source: "site",
    sourceMessageId: null,
    content: latestUserMessage.content,
    meta: {
      transport: "site",
    },
  })

  const linkedRequestPhase = getLinkedChangeRequestPhase(linkedChangeRequest?.status ?? null)
  const requestStartedFromStatus = linkedChangeRequest?.status ?? null
  const requestRunningStatus = linkedRequestPhase ? getRunningStatusForPhase(linkedRequestPhase) : null
  const linkedChangeRequestPhaseInstruction = getPhaseInstruction(linkedRequestPhase)
  let activeExecutionId: string | null = null
  let activeExecutionCreatedAt: string | null = null

  if (activeLinkedChangeRequestId && linkedChangeRequest && linkedRequestPhase && requestRunningStatus) {
    if (linkedRequestPhase === "execution" && hasActiveExecution(activeLinkedChangeRequestId)) {
      return NextResponse.json(
        { ok: false, error: "CHANGE_REQUEST_EXECUTION_ALREADY_RUNNING" },
        { status: 409 },
      )
    }

    if (linkedChangeRequest.status !== requestRunningStatus) {
      updateChangeRequest(activeLinkedChangeRequestId, {
        status: requestRunningStatus,
      })
    }

    const execution = createChangeRequestExecution({
      changeRequestId: activeLinkedChangeRequestId,
      targetEnvironmentId: activeLinkedTargetEnvironmentId ?? linkedChangeRequest.targetEnvironmentId,
      status: "running",
      actorType: "codex",
      startedAt: new Date().toISOString(),
      meta: {
        phase: linkedRequestPhase,
        transport: "site",
        sessionId: session.id,
        startedFromStatus: requestStartedFromStatus,
      },
    })
    activeExecutionId = execution?.id ?? null
    activeExecutionCreatedAt = execution?.createdAt ?? null
  }

  try {
    const runtimeResponse = await requestCodexRuntimeResponse({
      prompt: latestUserMessage.content,
      sessionId: session.id,
      codexThreadId: typeof session.meta?.codexThreadId === "string" ? session.meta.codexThreadId : null,
      recentHistory,
      metadata: {
        transport: "site",
        requestedSkills,
        linkedChangeRequestId: activeLinkedChangeRequestId,
        linkedTargetEnvironmentId: activeLinkedTargetEnvironmentId,
        linkedTargetApp,
        linkedTargetEnvironment,
        linkedDeployPlan,
        linkedLatestExecution: linkedLatestExecution
          ? {
              id: linkedLatestExecution.id,
              branchName: linkedLatestExecution.branchName,
              commitSha: linkedLatestExecution.commitSha,
              meta: linkedLatestExecution.meta,
            }
          : null,
        linkedChangeRequest: linkedChangeRequest
          ? {
              id: linkedChangeRequest.id,
              requestNumber: linkedChangeRequest.requestNumber,
              title: linkedChangeRequest.title,
              status: linkedChangeRequest.status,
              triageSummary: linkedChangeRequest.triageSummary,
              agentRecommendation: linkedChangeRequest.agentRecommendation,
              reviewNotes: linkedChangeRequest.reviewNotes,
            }
          : null,
        linkedChangeRequestInstruction: activeLinkedChangeRequestId
          ? linkedChangeRequestPhaseInstruction ??
            "This response is linked to a tracked change request. Treat recent user comments as instructions on that request. If you continue work, explain what changed or what blocked you."
          : null,
      },
    })

    const responseText = (runtimeResponse.responseText || runtimeResponse.output_text || "").trim()
    if (!responseText) {
      return NextResponse.json({ ok: false, error: "CODEX_RUNTIME_EMPTY_RESPONSE" }, { status: 502 })
    }

    const updatedSession = updateAgentSession(session.id, {
      title: session.title ?? latestUserMessage.content.slice(0, 80),
      linkedChangeRequestId: activeLinkedChangeRequestId,
      linkedTargetEnvironmentId: activeLinkedTargetEnvironmentId,
      meta: {
        ...session.meta,
        transport: "site",
        codexThreadId: runtimeResponse.thread_id ?? session.meta?.codexThreadId ?? null,
        codexProvider: runtimeResponse.provider ?? "codex-cli",
      },
      lastMessageAt: new Date().toISOString(),
    })

    const assistantMessage = createAgentMessage({
      sessionId: session.id,
      role: "assistant",
      source: "site",
      sourceMessageId: null,
      content: responseText,
      meta: {
        transport: "site",
        codexThreadId: runtimeResponse.thread_id ?? null,
      },
    })

    if (activeExecutionId) {
      const traceSummary = formatTraceSummary(runtimeResponse.trace as RuntimeTraceEntry[] | undefined)
      const gitPushState = summarizeGitPushState(runtimeResponse.trace as RuntimeTraceEntry[] | undefined)
      updateChangeRequestExecution(activeExecutionId, {
        status: "completed",
        branchName: runtimeResponse.branchName ?? null,
        commitSha: runtimeResponse.commitSha ?? null,
        summary: traceSummary ?? responseText.slice(0, 1200),
        finishedAt: new Date().toISOString(),
        meta: {
          phase: linkedRequestPhase,
          transport: "site",
          sessionId: session.id,
          startedFromStatus: requestStartedFromStatus,
          codexThreadId: runtimeResponse.thread_id ?? null,
          baseBranch: runtimeResponse.baseBranch ?? null,
          baseCommitSha: runtimeResponse.baseCommitSha ?? null,
          headCommitSha: runtimeResponse.commitSha ?? null,
          branchUrl: runtimeResponse.branchUrl ?? null,
          gitPushSucceeded: gitPushState.gitPushSucceeded,
          gitPushError: gitPushState.gitPushError,
          runtimeTrace: Array.isArray(runtimeResponse.trace) ? runtimeResponse.trace : [],
        },
      })
    }

    if (activeLinkedChangeRequestId && linkedRequestPhase) {
      if (linkedRequestPhase === "triage") {
        const strayExecutions = listChangeRequestExecutions(activeLinkedChangeRequestId).filter((execution) => {
          if (execution.id === activeExecutionId) {
            return false
          }

          if (!["planned", "running"].includes(execution.status)) {
            return false
          }

          if (!activeExecutionCreatedAt) {
            return true
          }

          return execution.createdAt >= activeExecutionCreatedAt
        })

        for (const execution of strayExecutions) {
          updateChangeRequestExecution(execution.id, {
            status: "failed",
            errorMessage: "Execution was started during a triage-only turn and has been suppressed.",
            summary: "Suppressed execution created before admin review.",
            finishedAt: new Date().toISOString(),
          })
        }

        updateChangeRequest(activeLinkedChangeRequestId, {
          status: "ready-for-agent",
        })
      } else if (requestRunningStatus) {
        const refreshedChangeRequest = getChangeRequest(activeLinkedChangeRequestId)
        if (refreshedChangeRequest?.status === requestRunningStatus) {
          updateChangeRequest(activeLinkedChangeRequestId, {
            status: getCompletedStatusForPhase(linkedRequestPhase),
          })
        }
      }
    }

    return NextResponse.json({
      id: assistantMessage?.id ?? randomUUID(),
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: runtimeResponse.model ?? "codex-runtime",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: responseText,
            },
          ],
        },
      ],
      output_text: responseText,
      session_id: updatedSession?.id ?? session.id,
      metadata: {
        codex_thread_id: runtimeResponse.thread_id ?? null,
        trace: Array.isArray(runtimeResponse.trace) ? runtimeResponse.trace : [],
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "CODEX_RUNTIME_REQUEST_FAILED"
    const failedAt = new Date().toISOString()
    const runtimeError = error as RuntimeError
    const failureTrace = Array.isArray(runtimeError.trace) ? runtimeError.trace : []
    const failureSummary = formatTraceSummary(failureTrace)

    if (activeLinkedChangeRequestId && linkedChangeRequest && linkedRequestPhase && requestRunningStatus) {
      if (activeExecutionId) {
        updateChangeRequestExecution(activeExecutionId, {
          status: "failed",
          branchName:
            typeof runtimeError.branchName === "string"
              ? runtimeError.branchName
              : linkedLatestExecution?.branchName ?? null,
          commitSha:
            typeof runtimeError.commitSha === "string"
              ? runtimeError.commitSha
              : linkedLatestExecution?.commitSha ?? null,
          errorMessage: message,
          summary: failureSummary,
          finishedAt: failedAt,
          meta: {
            phase: linkedRequestPhase,
            transport: "site",
            sessionId: session.id,
            startedFromStatus: requestStartedFromStatus,
            codexThreadId: runtimeError.codexThreadId ?? null,
            baseBranch:
              typeof runtimeError.baseBranch === "string"
                ? runtimeError.baseBranch
                : (linkedLatestExecution?.meta?.baseBranch as string | undefined) ?? null,
            baseCommitSha:
              typeof runtimeError.baseCommitSha === "string"
                ? runtimeError.baseCommitSha
                : (linkedLatestExecution?.meta?.baseCommitSha as string | undefined) ?? null,
            headCommitSha:
              typeof runtimeError.commitSha === "string"
                ? runtimeError.commitSha
                : linkedLatestExecution?.commitSha ?? null,
            runtimeTrace: failureTrace,
          },
        })
      }

      if (linkedRequestPhase === "triage") {
        updateChangeRequest(activeLinkedChangeRequestId, {
          status: requestStartedFromStatus ?? "submitted",
        })
      } else {
        const refreshedChangeRequest = getChangeRequest(activeLinkedChangeRequestId)
        if (refreshedChangeRequest?.status === requestRunningStatus) {
          updateChangeRequest(activeLinkedChangeRequestId, {
            status: requestStartedFromStatus ?? "ready-for-agent",
          })
        }
      }
    }

    createAgentMessage({
      sessionId: session.id,
      role: "assistant",
      source: "site",
      sourceMessageId: null,
      content: failureSummary ? `Run failed: ${message}\n\nRecent execution trace:\n${failureSummary}` : `Run failed: ${message}`,
      meta: {
        transport: "site",
        error: true,
        runtimeTrace: failureTrace,
      },
    })
    updateAgentSession(session.id, {
      linkedChangeRequestId: activeLinkedChangeRequestId,
      linkedTargetEnvironmentId: activeLinkedTargetEnvironmentId,
      lastMessageAt: new Date().toISOString(),
      meta: {
        ...session.meta,
        transport: "site",
      },
    })

    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
