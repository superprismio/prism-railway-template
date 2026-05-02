import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  createAgentMessage,
  createAgentSession,
  createChangeRequestExecution,
  createWorkflowEvent,
  ensureWorkflowRunForRequest,
  getAgentSession,
  getChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  getWorkflowByKey,
  listAgentMessages,
  listChangeRequestExecutions,
  loadConfig,
  updateAgentSession,
  updateChangeRequest,
  updateChangeRequestExecution,
  updateWorkflowRun,
} from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import { parseNullableString, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"

export async function GET(request: Request) {
  if (!useLocalAppApi()) {
    const url = new URL(request.url)
    const response = await adminFetch(`/api/v1/responses?${url.searchParams.toString()}`)
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

  const url = new URL(request.url)
  const sessionId = parseNullableString(url.searchParams.get("session_id") ?? url.searchParams.get("sessionId")) ?? null
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "session_id is required" }, { status: 400 })
  }

  const session = getAgentSession(sessionId)
  if (!session || session.source !== "admin-console") {
    return NextResponse.json({ ok: false, error: "Agent session not found" }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    session,
    messages: listAgentMessages(session.id, 100),
  })
}

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

function hasActiveExecution(changeRequestId: string, excludeExecutionId?: string | null) {
  return listChangeRequestExecutions(changeRequestId).some((execution) => {
    if (excludeExecutionId && execution.id === excludeExecutionId) {
      return false
    }

    return ["planned", "running"].includes(execution.status)
  })
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function workflowSteps(definition: Record<string, unknown> | undefined) {
  const raw = Array.isArray(definition?.steps) ? definition.steps : []
  return raw.filter(isRecord).filter((step) => typeof step.key === "string" && step.key.trim())
}

function stepKey(step: Record<string, unknown>) {
  return typeof step.key === "string" ? step.key.trim() : ""
}

function stepType(step: Record<string, unknown>) {
  return typeof step.type === "string" && step.type.trim() ? step.type.trim() : "agent"
}

function statusMap(step: Record<string, unknown>) {
  return Array.isArray(step.statusMap)
    ? step.statusMap.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function statusForStep(step: Record<string, unknown>, preference: "running" | "waiting" | "complete" = "waiting") {
  const statuses = statusMap(step)
  if (!statuses.length) return null
  if (preference === "running") {
    return statuses.find((status) => ["triaging", "in-progress"].includes(status)) ?? statuses[0]
  }
  return statuses[0]
}

function findStepByKey(steps: Record<string, unknown>[], key: string | null | undefined) {
  return steps.find((step) => stepKey(step) === key) ?? null
}

function findStepForStatus(steps: Record<string, unknown>[], status: string | null | undefined) {
  if (!status) return null
  return steps.find((step) => statusMap(step).includes(status)) ?? null
}

function nextStepForAction(steps: Record<string, unknown>[], step: Record<string, unknown>, action: string | null) {
  if (action && isRecord(step.routes)) {
    const routeValue = step.routes[action]
    if (typeof routeValue === "string") {
      return findStepByKey(steps, routeValue)
    }
  }
  const next = typeof step.next === "string" ? step.next : null
  return next ? findStepByKey(steps, next) : null
}

function readInstructionFile(instructionPath: unknown) {
  if (typeof instructionPath !== "string" || !instructionPath.trim()) {
    return null
  }
  const config = loadConfig()
  const normalized = instructionPath.trim()
  const siteWorkflowRoots = [
    path.resolve(config.workspaceRoot, "workflows"),
    path.resolve(config.repoRoot, "services/site/workflows"),
  ]
  const dataWorkflowRoot = path.resolve(config.dataRoot, "workflows")
  const candidates = path.isAbsolute(normalized)
    ? [path.resolve(normalized)]
    : [
        path.resolve(config.workspaceRoot, normalized),
        path.resolve(config.workspaceRoot, "workflows", normalized.replace(/^workflows\/+/, "")),
        path.resolve(config.repoRoot, "services/site", normalized.replace(/^\/+/, "")),
      ]
  const allowedRoots = [...siteWorkflowRoots, dataWorkflowRoot]
  const absolutePath = candidates.find((candidate) => {
    return allowedRoots.some((allowedRoot) => candidate === allowedRoot || candidate.startsWith(`${allowedRoot}${path.sep}`))
  })
  if (!absolutePath) {
    return null
  }
  try {
    return fs.readFileSync(absolutePath, "utf8").trim()
  } catch {
    return null
  }
}

function requestedSkillsFromAgentConfig(config: unknown) {
  if (!isRecord(config)) return []
  const skills = Array.isArray(config.skills) ? config.skills : []
  return skills.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
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
  const linkedTargetApp = linkedChangeRequest?.targetAppId ? getTargetApp(linkedChangeRequest.targetAppId) : null
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
  const workflowAction = parseNullableString(body.workflow_action ?? body.workflowAction) ?? null
  const linkedWorkflow = linkedChangeRequest ? getWorkflowByKey(linkedChangeRequest.workflowKey) : null
  const linkedWorkflowSteps = workflowSteps(linkedWorkflow?.definition)
  const linkedWorkflowRun = linkedChangeRequest
    ? ensureWorkflowRunForRequest({
        requestId: linkedChangeRequest.id,
        workflowKey: linkedChangeRequest.workflowKey,
        status: linkedChangeRequest.status,
      })
    : null
  const currentWorkflowStep =
    linkedWorkflowRun
      ? findStepByKey(linkedWorkflowSteps, linkedWorkflowRun.currentStepKey) ??
        findStepForStatus(linkedWorkflowSteps, linkedChangeRequest?.status)
      : null
  const runnableWorkflowStep =
    currentWorkflowStep && stepType(currentWorkflowStep) === "gate"
      ? nextStepForAction(linkedWorkflowSteps, currentWorkflowStep, workflowAction || "approved")
      : currentWorkflowStep
  const workflowStepInstruction = runnableWorkflowStep
    ? readInstructionFile(runnableWorkflowStep.instructionPath)
    : null
  const workflowAgentConfig = {
    ...(isRecord(linkedWorkflow?.definition?.agentConfig) ? linkedWorkflow.definition.agentConfig : {}),
    ...(isRecord(runnableWorkflowStep?.agentConfig) ? runnableWorkflowStep?.agentConfig : {}),
  }
  const requestedSkillsInput: unknown[] = Array.isArray(body.requested_skills ?? body.requestedSkills)
    ? (body.requested_skills ?? body.requestedSkills) as unknown[]
    : []
  const requestedSkills = Array.from(
    new Set([
      ...requestedSkillsInput
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry: string) => entry.trim()),
      ...requestedSkillsFromAgentConfig(workflowAgentConfig),
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

  const requestStartedFromStatus = linkedChangeRequest?.status ?? null
  const requestRunningStatus = runnableWorkflowStep ? statusForStep(runnableWorkflowStep, "running") : null
  const requestCompletedStatus = runnableWorkflowStep
    ? statusForStep(nextStepForAction(linkedWorkflowSteps, runnableWorkflowStep, "approved") ?? runnableWorkflowStep, "waiting")
    : null
  const runnableStepKey = runnableWorkflowStep ? stepKey(runnableWorkflowStep) : null
  let activeExecutionId: string | null = null

  if (activeLinkedChangeRequestId && linkedChangeRequest && linkedWorkflowRun && runnableWorkflowStep && requestRunningStatus) {
    if (stepType(runnableWorkflowStep) !== "agent") {
      return NextResponse.json(
        { ok: false, error: "WORKFLOW_STEP_NOT_RUNNABLE" },
        { status: 409 },
      )
    }

    if (hasActiveExecution(activeLinkedChangeRequestId)) {
      return NextResponse.json(
        { ok: false, error: "CHANGE_REQUEST_EXECUTION_ALREADY_RUNNING" },
        { status: 409 },
      )
    }

    if (currentWorkflowStep && stepType(currentWorkflowStep) === "gate") {
      createWorkflowEvent({
        workflowRunId: linkedWorkflowRun.id,
        requestId: activeLinkedChangeRequestId,
        stepKey: stepKey(currentWorkflowStep),
        eventType: `gate.${workflowAction || "approved"}`,
        actorType: "admin",
        note: latestUserMessage.content,
        payload: {
          fromStepKey: stepKey(currentWorkflowStep),
          toStepKey: runnableStepKey,
          startedFromStatus: requestStartedFromStatus,
        },
      })
    }

    if (linkedChangeRequest.status !== requestRunningStatus) {
      updateChangeRequest(activeLinkedChangeRequestId, {
        status: requestRunningStatus,
      })
    }
    updateWorkflowRun({
      requestId: activeLinkedChangeRequestId,
      currentStepKey: runnableStepKey ?? linkedWorkflowRun.currentStepKey,
      status: "active",
      completedAt: null,
    })
    createWorkflowEvent({
      workflowRunId: linkedWorkflowRun.id,
      requestId: activeLinkedChangeRequestId,
      stepKey: runnableStepKey,
      eventType: "agent.started",
      actorType: "codex",
      payload: {
        status: requestRunningStatus,
        action: workflowAction,
      },
    })

    const execution = createChangeRequestExecution({
      changeRequestId: activeLinkedChangeRequestId,
      targetEnvironmentId: activeLinkedTargetEnvironmentId ?? linkedChangeRequest.targetEnvironmentId,
      status: "running",
      actorType: "codex",
      startedAt: new Date().toISOString(),
      meta: {
        workflowKey: linkedChangeRequest.workflowKey,
        workflowRunId: linkedWorkflowRun.id,
        workflowStepKey: runnableStepKey,
        transport: "site",
        sessionId: session.id,
        startedFromStatus: requestStartedFromStatus,
      },
    })
    activeExecutionId = execution?.id ?? null
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
          workflow: linkedWorkflow
            ? {
                key: linkedWorkflow.key,
                name: linkedWorkflow.name,
                currentStepKey: runnableStepKey,
                action: workflowAction,
                agentConfig: workflowAgentConfig,
                stepInstruction: workflowStepInstruction,
              }
            : null,
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
          ? [
              workflowStepInstruction
                ? `Workflow step instructions:\n${workflowStepInstruction}`
                : "This response is linked to a tracked request workflow step.",
              runnableStepKey ? `Current workflow step: ${runnableStepKey}.` : null,
              requestCompletedStatus ? `When this step is complete, the request should move toward ${requestCompletedStatus}.` : null,
            ].filter(Boolean).join("\n\n")
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
          workflowKey: linkedChangeRequest?.workflowKey ?? null,
          workflowRunId: linkedWorkflowRun?.id ?? null,
          workflowStepKey: runnableStepKey,
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

    if (activeLinkedChangeRequestId && linkedWorkflowRun && runnableStepKey) {
      createWorkflowEvent({
        workflowRunId: linkedWorkflowRun.id,
        requestId: activeLinkedChangeRequestId,
        stepKey: runnableStepKey,
        eventType: "agent.completed",
        actorType: "codex",
        payload: {
          status: requestCompletedStatus,
          executionId: activeExecutionId,
          branchName: runtimeResponse.branchName ?? null,
          commitSha: runtimeResponse.commitSha ?? null,
        },
      })
      if (requestCompletedStatus) {
        updateChangeRequest(activeLinkedChangeRequestId, {
          status: requestCompletedStatus,
        })
        const nextStep = findStepForStatus(linkedWorkflowSteps, requestCompletedStatus)
        updateWorkflowRun({
          requestId: activeLinkedChangeRequestId,
          currentStepKey: nextStep ? stepKey(nextStep) : runnableStepKey,
          status: ["approved", "rejected", "closed"].includes(requestCompletedStatus) ? "completed" : "active",
          completedAt: ["approved", "rejected", "closed"].includes(requestCompletedStatus) ? new Date().toISOString() : null,
        })
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

    if (activeLinkedChangeRequestId && linkedChangeRequest && linkedWorkflowRun && runnableStepKey && requestRunningStatus) {
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
            workflowKey: linkedChangeRequest.workflowKey,
            workflowRunId: linkedWorkflowRun.id,
            workflowStepKey: runnableStepKey,
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

      createWorkflowEvent({
        workflowRunId: linkedWorkflowRun.id,
        requestId: activeLinkedChangeRequestId,
        stepKey: runnableStepKey,
        eventType: "agent.failed",
        actorType: "codex",
        note: message,
        payload: {
          executionId: activeExecutionId,
          runtimeTrace: failureTrace,
        },
      })
      const refreshedChangeRequest = getChangeRequest(activeLinkedChangeRequestId)
      if (refreshedChangeRequest?.status === requestRunningStatus) {
        updateChangeRequest(activeLinkedChangeRequestId, {
          status: requestStartedFromStatus ?? linkedChangeRequest.status,
        })
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
