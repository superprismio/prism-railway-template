import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  createAgentMessage,
  createAgentRun,
  createAgentSession,
  createWorkflowEvent,
  ensureWorkflowRunForRequest,
  findActiveAgentRunByIdempotencyKey,
  getAgentSession,
  getAgentRun,
  getChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listAgentRuns,
  listActiveAgentRunsForRequest,
  listAgentMessages,
  listRequestExternalRefs,
  loadConfig,
  updateAgentSession,
  updateAgentRun,
  updateAgentResponseJob,
  updateChangeRequest,
  updateWorkflowRun,
} from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import { parseNullableString, useLocalAppApi } from "@/lib/local-admin-api"
import { listEnabledGatewayToolsetsOrEmpty, listInteractiveGatewayCapabilitiesOrEmpty } from "@/lib/prism-gateway"
import type { GatewayCapabilityDescriptor } from "@/lib/prism-gateway-policy"
import { isLoopWorkflowStep, loopIterationKeyForRequest, resolveControlFlowSteps } from "@/lib/workflow-control-flow"
import { findStepByKey, gateEventAction, nextStepForAction, stepKey, stepType, workflowSteps } from "@/lib/workflow-steps"

type RouteAccessCheck = () => Promise<{ ok: true } | { ok: false; error: string; status: number }>

export async function handleResponseGet(request: Request, requireAccess: RouteAccessCheck) {
  const auth = await requireAccess()
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }

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

type RuntimeJobPayload = {
  ok?: boolean
  jobId?: string
  job?: {
    id?: string
    status?: string
    response?: RuntimeResponsePayload | null
    error?: string | null
    threadId?: string | null
    trace?: Array<{ at?: string; kind?: string; message?: string }>
  }
  response?: RuntimeResponsePayload | null
  error?: string | null
  thread_id?: string | null
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

type WorkflowOutcomeStatus = "completed" | "blocked" | "needs_attention"

type WorkflowOutcome = {
  status: WorkflowOutcomeStatus
  summary: string | null
  suggestedFix: string | null
  blockers: Array<Record<string, unknown>>
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

function hasActiveAgentRun(changeRequestId: string, excludeAgentRunId?: string | null) {
  return listActiveAgentRunsForRequest(changeRequestId).some((run) => run.id !== excludeAgentRunId)
}

function isStoppedAgentRunStatus(status: string | null | undefined) {
  return status === "canceled" || status === "superseded"
}

function workflowStepRunIdempotencyKey(input: {
  requestId: string
  workflowRunId: string
  stepKey: string
  action?: string | null
  loopIterationKey?: string | null
}) {
  const actionKey = input.action && input.action.trim() ? input.action.trim() : "run"
  const loopKey = input.loopIterationKey && input.loopIterationKey.trim() ? `:${input.loopIterationKey.trim()}` : ""
  return `workflow:${input.requestId}:${input.workflowRunId}:${input.stepKey}:${actionKey}${loopKey}`
}

function workflowAgentRunLeaseSeconds() {
  const numberValue = Number(process.env.PRISM_AGENT_RUN_LEASE_SECONDS)
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.trunc(numberValue) : 1800
}

function addSecondsIso(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000).toISOString()
}

function agentRunResultString(run: ReturnType<typeof getAgentRun> | null, key: string) {
  const value = run?.result?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function workflowRunStillOnStep(requestId: string, workflowRunId: string, stepKey: string) {
  const run = getWorkflowRunForRequest(requestId)
  return Boolean(run && run.id === workflowRunId && run.status === "active" && run.currentStepKey === stepKey)
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

function describeRuntimeFetchFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return "fetch failed"
  }

  const cause = error.cause
  if (cause && typeof cause === "object") {
    const record = cause as Record<string, unknown>
    const code = typeof record.code === "string" ? record.code : null
    const causeMessage = typeof record.message === "string" ? record.message : null
    if (code && causeMessage) {
      return `${error.message}:${code}:${causeMessage}`
    }
    if (code) {
      return `${error.message}:${code}`
    }
    if (causeMessage) {
      return `${error.message}:${causeMessage}`
    }
  }

  return error.message || "fetch failed"
}

function normalizeWorkflowOutcomeStatus(value: unknown): WorkflowOutcomeStatus | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase().replace(/-/g, "_")
  if (normalized === "completed" || normalized === "blocked" || normalized === "needs_attention") {
    return normalized
  }
  return null
}

function normalizeWorkflowOutcome(value: unknown): WorkflowOutcome | null {
  if (!isRecord(value)) return null
  const source = isRecord(value.workflowOutcome) ? value.workflowOutcome : value
  const status = normalizeWorkflowOutcomeStatus(source.status)
  if (!status) return null
  const summary = typeof source.summary === "string" && source.summary.trim() ? source.summary.trim() : null
  const suggestedFix =
    typeof source.suggestedFix === "string" && source.suggestedFix.trim()
      ? source.suggestedFix.trim()
      : typeof source.suggested_fix === "string" && source.suggested_fix.trim()
        ? source.suggested_fix.trim()
        : null
  const blockers = Array.isArray(source.blockers)
    ? source.blockers.filter(isRecord).map((blocker) => ({ ...blocker }))
    : []
  return {
    status,
    summary,
    suggestedFix,
    blockers,
  }
}

function parseWorkflowOutcomeFromResponseText(responseText: string) {
  const fencePattern = /```(?:workflow-outcome|workflow_outcome)\s*([\s\S]*?)```/gi
  for (const match of responseText.matchAll(fencePattern)) {
    const rawJson = match[1]?.trim()
    if (!rawJson) continue
    try {
      const parsed = JSON.parse(rawJson) as unknown
      const outcome = normalizeWorkflowOutcome(parsed)
      if (outcome) return outcome
    } catch {
      continue
    }
  }
  return null
}

function workflowOutcomeStopsAutoContinue(outcome: WorkflowOutcome | null | undefined) {
  return outcome?.status === "blocked" || outcome?.status === "needs_attention"
}

function workflowOutcomeInstruction() {
  return [
    "If this step is blocked or needs operator attention, include a fenced workflow outcome JSON block in your final response.",
    'Use this exact fence: ```workflow-outcome {"status":"blocked","summary":"...","suggestedFix":"...","blockers":[{"key":"stable-key","severity":"hard","reason":"...","suggestedFix":"...","canOverride":true}]} ```.',
    "Use status `needs_attention` for operator review/warnings and `blocked` when the workflow must not advance. If the step is complete, omit the block.",
  ].join(" ")
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runtimeRequestTimeoutMs() {
  const parsed = Number.parseInt(process.env.CODEX_RUNTIME_TIMEOUT_MS ?? "", 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(parsed + 60_000, 60_000)
  }
  return 900_000
}

function readPositiveInteger(value: unknown, fallback: number) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.trunc(numberValue) : fallback
}

function maxAutoContinueSteps() {
  return Math.min(readPositiveInteger(process.env.PRISM_WORKFLOW_MAX_AUTO_CONTINUE_STEPS, 100), 100)
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function workflowActorType(request: Request) {
  try {
    const pathname = new URL(request.url).pathname
    return pathname.startsWith("/admin/") ? "admin" : "agent"
  } catch {
    return "agent"
  }
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

function requestedCapabilitiesFromAgentConfig(config: unknown) {
  if (!isRecord(config)) return []
  const capabilities = Array.isArray(config.gatewayCapabilities)
    ? config.gatewayCapabilities
    : Array.isArray(config.capabilities)
      ? config.capabilities
      : []
  return Array.from(new Set(capabilities
    .map((entry) => {
      if (typeof entry === "string") return entry.trim()
      if (isRecord(entry) && typeof entry.key === "string") return entry.key.trim()
      return ""
    })
    .filter((key) => /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(key))))
}

function requestedToolsetsFromAgentConfig(config: unknown) {
  if (!isRecord(config)) return []
  const toolsets = Array.isArray(config.gatewayToolsets)
    ? config.gatewayToolsets
    : Array.isArray(config.toolsets)
      ? config.toolsets
      : []
  return Array.from(new Set(toolsets
    .map((entry) => typeof entry === "string" ? entry.trim() : isRecord(entry) && typeof entry.key === "string" ? entry.key.trim() : "")
    .filter((key) => /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(key))))
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
  capabilities?: Array<string | GatewayCapabilityDescriptor>
  toolsets?: Array<{ key: string; protocol?: "openapi" | "mcp" | "http" | "adapter" }>
  gatewayContext?: Record<string, string | undefined>
  metadata: Record<string, unknown>
  onProgress?: (progress: {
    status: string
    runtimeJobId: string
    threadId: string | null
    trace: RuntimeTraceEntry[]
  }) => void
}) {
  const config = loadConfig()
  if (!config.codexRuntimeBaseUrl) {
    throw new Error("CODEX_RUNTIME_BASE_URL_MISSING")
  }

  const runtimeInput = {
    prompt: input.prompt,
    sessionId: input.sessionId,
    codexThreadId: input.codexThreadId ?? null,
    recentHistory: input.recentHistory,
    capabilities: (input.capabilities ?? []).map((capability) =>
      typeof capability === "string" ? { key: capability } : capability),
    toolsets: input.toolsets ?? [],
    context: input.gatewayContext ?? {},
    metadata: input.metadata,
  }
  const runtimeJobsUrl = `${config.codexRuntimeBaseUrl}/v1/responses/jobs`
  const runtimeUrl = `${config.codexRuntimeBaseUrl}/v1/responses`
  let jobId: string | null = null
  const startedAt = Date.now()
  const timeoutMs = runtimeRequestTimeoutMs()
  const remainingTimeoutMs = () => Math.max(1, timeoutMs - (Date.now() - startedAt))

  try {
    const submitResponse = await fetchWithTimeout(runtimeJobsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(runtimeInput),
    }, Math.min(30_000, timeoutMs))

    if (submitResponse.status !== 404) {
      const submitPayload = (await submitResponse.json().catch(() => null)) as RuntimeJobPayload | null
      if (!submitResponse.ok) {
        throw new Error(
          `CODEX_RUNTIME_JOB_CREATE_FAILED:${submitResponse.status}:${submitPayload?.error || "Unknown codex runtime error"}`,
        )
      }

      jobId = typeof submitPayload?.jobId === "string" ? submitPayload.jobId : null
      if (!jobId) {
        throw new Error("CODEX_RUNTIME_JOB_CREATE_INVALID_RESPONSE")
      }

      const pollUrl = `${runtimeJobsUrl}/${encodeURIComponent(jobId)}`
      for (;;) {
        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error(`CODEX_RUNTIME_REQUEST_TIMEOUT:${timeoutMs}`)
        }
        await sleep(2000)
        const pollResponse = await fetchWithTimeout(
          pollUrl,
          { cache: "no-store" },
          Math.min(30_000, remainingTimeoutMs()),
        )
        const pollPayload = (await pollResponse.json().catch(() => null)) as RuntimeJobPayload | null

        if (!pollResponse.ok) {
          throw new Error(
            `CODEX_RUNTIME_JOB_POLL_FAILED:${pollResponse.status}:${pollPayload?.error || "Unknown codex runtime error"}`,
          )
        }

        const status = typeof pollPayload?.job?.status === "string" ? pollPayload.job.status : ""
        const trace = Array.isArray(pollPayload?.trace)
          ? pollPayload.trace
              .map((entry) => ({
                at: typeof entry?.at === "string" ? entry.at : new Date().toISOString(),
                kind: typeof entry?.kind === "string" ? entry.kind : "runtime",
                message: typeof entry?.message === "string" ? entry.message : "",
              }))
              .filter((entry) => entry.message.trim())
          : []
        input.onProgress?.({
          status,
          runtimeJobId: jobId,
          threadId:
            pollPayload?.thread_id ??
            pollPayload?.job?.threadId ??
            null,
          trace,
        })
        if (status === "queued" || status === "running") {
          continue
        }

        if (status === "succeeded") {
          const payload = pollPayload?.response ?? pollPayload?.job?.response ?? null
          if (!payload) {
            throw new Error("CODEX_RUNTIME_JOB_INVALID_RESPONSE")
          }
          return payload
        }

        const error = new Error(
          `CODEX_RUNTIME_REQUEST_FAILED:500:${pollPayload?.error || pollPayload?.job?.error || "Unknown codex runtime error"}`,
        ) as RuntimeError
        error.codexThreadId =
          pollPayload?.thread_id ??
          pollPayload?.job?.threadId ??
          null
        error.trace = trace
        throw error
      }
    }
  } catch (error) {
    if (jobId) {
      throw error
    }
    const message = describeRuntimeFetchFailure(error)
    console.warn(JSON.stringify({
      event: "codex_runtime.job_path_unavailable",
      url: runtimeJobsUrl,
      error: message,
    }))
  }

  let response: Response
  try {
    response = await fetchWithTimeout(runtimeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(runtimeInput),
    }, Math.max(1, remainingTimeoutMs()))
  } catch (error) {
    const message = describeRuntimeFetchFailure(error)
    console.warn(JSON.stringify({
      event: "codex_runtime.fetch_failed",
      url: runtimeUrl,
      error: message,
    }))
    throw new Error(`CODEX_RUNTIME_FETCH_FAILED:${message}`)
  }

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

function isTerminalWorkflowStep(step: Record<string, unknown> | null | undefined) {
  return step ? stepType(step) === "terminal" : false
}

function isCheckpointWorkflowStep(step: Record<string, unknown> | null | undefined) {
  return step ? stepType(step) === "checkpoint" : false
}

function workflowAgentRunResult(input: {
  runtimeResponse: RuntimeResponsePayload
  responseText?: string | null
  workflowKey: string | null
  workflowRunId: string
  workflowStepKey: string
  sessionId: string
  workflowOutcome?: WorkflowOutcome | null
  autoContinued?: boolean
  ignored?: boolean
  reason?: string | null
  expectedStepKey?: string | null
}) {
  const gitPushState = summarizeGitPushState(input.runtimeResponse.trace as RuntimeTraceEntry[] | undefined)
  return {
    responseText: input.responseText ?? null,
    workflowKey: input.workflowKey,
    workflowRunId: input.workflowRunId,
    workflowStepKey: input.workflowStepKey,
    sessionId: input.sessionId,
    autoContinued: input.autoContinued === true,
    codexThreadId: input.runtimeResponse.thread_id ?? null,
    branchName: input.runtimeResponse.branchName ?? null,
    commitSha: input.runtimeResponse.commitSha ?? null,
    baseBranch: input.runtimeResponse.baseBranch ?? null,
    baseCommitSha: input.runtimeResponse.baseCommitSha ?? null,
    headCommitSha: input.runtimeResponse.commitSha ?? null,
    branchUrl: input.runtimeResponse.branchUrl ?? null,
    workflowOutcome: input.workflowOutcome ?? null,
    gitPushSucceeded: gitPushState.gitPushSucceeded,
    gitPushError: gitPushState.gitPushError,
    ignored: input.ignored === true,
    reason: input.reason ?? null,
    expectedStepKey: input.expectedStepKey ?? null,
  }
}

function failedWorkflowAgentRunResult(input: {
  runtimeError: RuntimeError
  latestAgentRun: ReturnType<typeof getAgentRun> | null
  workflowKey: string | null
  workflowRunId: string
  workflowStepKey: string
  sessionId: string
}) {
  return {
    responseText: null,
    workflowKey: input.workflowKey,
    workflowRunId: input.workflowRunId,
    workflowStepKey: input.workflowStepKey,
    sessionId: input.sessionId,
    codexThreadId: input.runtimeError.codexThreadId ?? null,
    branchName:
      typeof input.runtimeError.branchName === "string"
        ? input.runtimeError.branchName
        : agentRunResultString(input.latestAgentRun, "branchName"),
    commitSha:
      typeof input.runtimeError.commitSha === "string"
        ? input.runtimeError.commitSha
        : agentRunResultString(input.latestAgentRun, "commitSha"),
    baseBranch:
      typeof input.runtimeError.baseBranch === "string"
        ? input.runtimeError.baseBranch
        : agentRunResultString(input.latestAgentRun, "baseBranch"),
    baseCommitSha:
      typeof input.runtimeError.baseCommitSha === "string"
        ? input.runtimeError.baseCommitSha
        : agentRunResultString(input.latestAgentRun, "baseCommitSha"),
    headCommitSha:
      typeof input.runtimeError.commitSha === "string"
        ? input.runtimeError.commitSha
        : agentRunResultString(input.latestAgentRun, "headCommitSha") ?? agentRunResultString(input.latestAgentRun, "commitSha"),
  }
}

function completeWorkflowAgentStep(input: {
  runtimeResponse: RuntimeResponsePayload
  responseText: string
  requestId: string
  workflowRunId: string
  workflowKey: string | null
  stepKey: string
  nextStep: Record<string, unknown> | null
  linkedWorkflowSteps: Record<string, unknown>[]
  sessionId: string
  autoContinued?: boolean
  agentRunId?: string | null
}) {
  const agentRunId = input.agentRunId ?? null
  const agentRun = agentRunId ? getAgentRun(agentRunId) : null
  const workflowOutcome = parseWorkflowOutcomeFromResponseText(input.responseText)
  const shouldStopForOutcome =
    workflowOutcome?.status === "blocked" || workflowOutcome?.status === "needs_attention"
  if (isStoppedAgentRunStatus(agentRun?.status)) {
    if (agentRunId) {
      updateAgentRun(agentRunId, {
        status: agentRun?.status ?? "canceled",
        result: {
          ignored: true,
          reason: `agent_run_${agentRun?.status ?? "stopped"}`,
          responseText: input.responseText.slice(0, 4000),
        },
        trace: Array.isArray(input.runtimeResponse.trace) ? input.runtimeResponse.trace : [],
        finishedAt: new Date().toISOString(),
      })
    }
    createWorkflowEvent({
      workflowRunId: input.workflowRunId,
      requestId: input.requestId,
      stepKey: input.stepKey,
      eventType: "agent.completion_ignored",
      actorType: "system",
      note: `Ignored a late runtime completion because the agent run was ${agentRun?.status ?? "stopped"}.`,
      payload: {
        agentRunId,
      },
    })
    return false
  }

  if (agentRunId) {
    updateAgentRun(agentRunId, {
      status: "succeeded",
      result: workflowAgentRunResult({
        runtimeResponse: input.runtimeResponse,
        responseText: input.responseText,
        workflowKey: input.workflowKey,
        workflowRunId: input.workflowRunId,
        workflowStepKey: input.stepKey,
        sessionId: input.sessionId,
        workflowOutcome,
        autoContinued: input.autoContinued,
      }),
      trace: Array.isArray(input.runtimeResponse.trace) ? input.runtimeResponse.trace : [],
      errorMessage: null,
      leaseExpiresAt: null,
      queueReason: null,
      finishedAt: new Date().toISOString(),
    })
  }

  const currentStep = findStepByKey(input.linkedWorkflowSteps, input.stepKey)
  const shouldStayOnStep = isCheckpointWorkflowStep(currentStep)
  if (!workflowRunStillOnStep(input.requestId, input.workflowRunId, input.stepKey)) {
    if (agentRunId) {
      updateAgentRun(agentRunId, {
        result: workflowAgentRunResult({
          runtimeResponse: input.runtimeResponse,
          responseText: input.responseText,
          workflowKey: input.workflowKey,
          workflowRunId: input.workflowRunId,
          workflowStepKey: input.stepKey,
          sessionId: input.sessionId,
          workflowOutcome,
          autoContinued: input.autoContinued,
          ignored: true,
          reason: "workflow_moved",
          expectedStepKey: input.stepKey,
        }),
      })
    }
    createWorkflowEvent({
      workflowRunId: input.workflowRunId,
      requestId: input.requestId,
      stepKey: input.stepKey,
      eventType: "agent.completion_ignored",
      actorType: "system",
      note: "Ignored a late runtime completion because the workflow moved to another step.",
      payload: {
        agentRunId,
        expectedStepKey: input.stepKey,
      },
    })
    return false
  }

  if (shouldStopForOutcome && workflowOutcome) {
    createWorkflowEvent({
      workflowRunId: input.workflowRunId,
      requestId: input.requestId,
      stepKey: input.stepKey,
      eventType: workflowOutcome.status === "blocked" ? "agent.blocked" : "agent.needs_attention",
      actorType: "codex",
      note: workflowOutcome.summary ?? undefined,
      payload: {
        agentRunId,
        autoContinued: input.autoContinued === true,
        workflowOutcome,
      },
    })
    updateChangeRequest(input.requestId, {
      workflowStepKey: input.stepKey,
    })
    updateWorkflowRun({
      requestId: input.requestId,
      currentStepKey: input.stepKey,
      status: "active",
      completedAt: null,
    })
    return input.stepKey
  }

  createWorkflowEvent({
    workflowRunId: input.workflowRunId,
    requestId: input.requestId,
    stepKey: input.stepKey,
    eventType: shouldStayOnStep ? "checkpoint.checked" : "agent.completed",
    actorType: "codex",
    payload: {
      agentRunId,
      autoContinued: input.autoContinued === true,
      branchName: input.runtimeResponse.branchName ?? null,
      commitSha: input.runtimeResponse.commitSha ?? null,
      nextStepKey: input.nextStep ? stepKey(input.nextStep) : null,
    },
  })

  const nextStep = input.nextStep
  const nextStepKey = !shouldStayOnStep && nextStep ? stepKey(nextStep) ?? input.stepKey : input.stepKey
  updateChangeRequest(input.requestId, {
    workflowStepKey: nextStepKey,
  })
  const terminal = isTerminalWorkflowStep(nextStep)
  updateWorkflowRun({
    requestId: input.requestId,
    currentStepKey: nextStepKey,
    status: terminal ? "completed" : "active",
    completedAt: terminal ? new Date().toISOString() : null,
  })
  if (nextStepKey !== input.stepKey) {
    createWorkflowEvent({
      workflowRunId: input.workflowRunId,
      requestId: input.requestId,
      stepKey: nextStepKey,
      eventType: "workflow.step_changed",
      actorType: "system",
      payload: {
        previousStepKey: input.stepKey,
        nextStepKey,
        autoContinued: input.autoContinued === true,
      },
    })
  }
  if (!shouldStayOnStep && nextStep && isLoopWorkflowStep(nextStep)) {
    const resolved = resolveControlFlowSteps({
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      steps: input.linkedWorkflowSteps,
      step: nextStep,
      autoContinued: input.autoContinued,
    })
    return resolved.step ? stepKey(resolved.step) : nextStepKey
  }
  return nextStepKey
}

function completeWorkflowGateStep(input: {
  requestId: string
  requestNumber: number
  requestTitle: string
  workflowRunId: string
  fromStep: Record<string, unknown>
  toStep: Record<string, unknown>
  action: string
  actorType: string
  note: string
}) {
  const fromStepKey = stepKey(input.fromStep) ?? ""
  const toStepKey = stepKey(input.toStep) ?? ""

  createWorkflowEvent({
    workflowRunId: input.workflowRunId,
    requestId: input.requestId,
    stepKey: fromStepKey,
    eventType: `gate.${input.action}`,
    actorType: input.actorType,
    note: input.note,
    payload: {
      fromStepKey,
      toStepKey,
    },
  })

  updateChangeRequest(input.requestId, {
    workflowStepKey: toStepKey,
  })
  updateWorkflowRun({
    requestId: input.requestId,
    currentStepKey: toStepKey,
    status: isTerminalWorkflowStep(input.toStep) ? "completed" : "active",
    completedAt: isTerminalWorkflowStep(input.toStep) ? new Date().toISOString() : null,
  })
  createWorkflowEvent({
    workflowRunId: input.workflowRunId,
    requestId: input.requestId,
    stepKey: toStepKey,
    eventType: "workflow.step_changed",
    actorType: "system",
    payload: {
      previousStepKey: fromStepKey,
      nextStepKey: toStepKey,
      action: input.action,
    },
  })

  const toLabel = typeof input.toStep.label === "string" && input.toStep.label.trim()
    ? input.toStep.label.trim()
    : toStepKey
  return `Workflow gate ${input.action} completed for request #${input.requestNumber}: ${input.requestTitle}. Moved to ${toLabel}.`
}

function startWorkflowAgentStep(input: {
  requestId: string
  workflowRunId: string
  workflowKey: string
  stepKey: string
  sessionId: string
  idempotencyKey: string
  agentRunId?: string | null
  action?: string | null
  autoContinued?: boolean
}) {
  const existingAgentRun = input.agentRunId ? getAgentRun(input.agentRunId) : null
  if (input.agentRunId && !existingAgentRun) {
    return null
  }
  const startedAt = new Date().toISOString()
  const leaseExpiresAt = addSecondsIso(new Date(startedAt), workflowAgentRunLeaseSeconds())

  updateChangeRequest(input.requestId, {
    workflowStepKey: input.stepKey,
  })
  updateWorkflowRun({
    requestId: input.requestId,
    currentStepKey: input.stepKey,
    status: "active",
    completedAt: null,
  })
  createWorkflowEvent({
    workflowRunId: input.workflowRunId,
    requestId: input.requestId,
    stepKey: input.stepKey,
    eventType: "agent.started",
    actorType: "codex",
    payload: {
      action: input.action,
      autoContinued: input.autoContinued === true,
    },
  })

  const agentRun = input.agentRunId
    ? updateAgentRun(input.agentRunId, {
        status: "running",
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
        workflowRunId: input.workflowRunId,
        workflowStepKey: input.stepKey,
        sessionId: input.sessionId,
        source: "site",
        claimedAt: existingAgentRun?.claimedAt ?? startedAt,
        leaseExpiresAt,
        startedAt,
      }) ?? getAgentRun(input.agentRunId)
    : createAgentRun({
        kind: "workflow_step",
        status: "running",
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
        workflowRunId: input.workflowRunId,
        workflowStepKey: input.stepKey,
        sessionId: input.sessionId,
        source: "site",
        input: {
          workflowKey: input.workflowKey,
          workflowStepKey: input.stepKey,
          action: input.action ?? null,
          autoContinued: input.autoContinued === true,
        },
        claimedAt: startedAt,
        leaseExpiresAt,
        startedAt,
      })
  return agentRun?.id ?? null
}

export async function handleResponsePost(request: Request, requireAccess: RouteAccessCheck) {
  const auth = await requireAccess()
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }

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
  const linkedLatestAgentRun = activeLinkedChangeRequestId
    ? listAgentRuns({ requestId: activeLinkedChangeRequestId, limit: 1 })[0] ?? null
    : null
  const linkedExternalRefs = activeLinkedChangeRequestId
    ? listRequestExternalRefs(activeLinkedChangeRequestId)
    : []
  const workflowAction = parseNullableString(body.workflow_action ?? body.workflowAction) ?? null
  const actorType = workflowActorType(request)
  const autoContinueUntilGate = Boolean(activeLinkedChangeRequestId)
  const responseJobId = parseNullableString(body.response_job_id ?? body.responseJobId) ?? null
  const providedAgentRunId = parseNullableString(body.agent_run_id ?? body.agentRunId) ?? null
  if (providedAgentRunId && !getAgentRun(providedAgentRunId)) {
    return NextResponse.json(
      { ok: false, error: "UNKNOWN_AGENT_RUN", agentRunId: providedAgentRunId },
      { status: 409 },
    )
  }
  const recordRuntimeProgress = responseJobId
    ? (progress: {
        status: string
        runtimeJobId: string
        threadId: string | null
        trace: RuntimeTraceEntry[]
      }) => {
        updateAgentResponseJob(responseJobId, {
          status: "running",
          response: {
            runtimeJobId: progress.runtimeJobId,
            runtimeJobStatus: progress.status,
            runtimeThreadId: progress.threadId,
            lastProgressAt: new Date().toISOString(),
          },
          trace: progress.trace,
        })
      }
    : undefined
  const linkedWorkflow = linkedChangeRequest ? getWorkflowByKey(linkedChangeRequest.workflowKey) : null
  const linkedWorkflowSteps = workflowSteps(linkedWorkflow?.definition)
  const linkedWorkflowRun = linkedChangeRequest
    ? ensureWorkflowRunForRequest({
        requestId: linkedChangeRequest.id,
        workflowKey: linkedChangeRequest.workflowKey,
      })
    : null
  let currentWorkflowStep =
    linkedWorkflowRun
      ? findStepByKey(linkedWorkflowSteps, linkedWorkflowRun.currentStepKey) ??
        findStepByKey(linkedWorkflowSteps, typeof linkedWorkflow?.definition?.entrypoint === "string" ? linkedWorkflow.definition.entrypoint : null)
      : null
  if (
    activeLinkedChangeRequestId &&
    linkedWorkflowRun &&
    currentWorkflowStep &&
    isLoopWorkflowStep(currentWorkflowStep)
  ) {
    const resolved = resolveControlFlowSteps({
      requestId: activeLinkedChangeRequestId,
      workflowRunId: linkedWorkflowRun.id,
      steps: linkedWorkflowSteps,
      step: currentWorkflowStep,
    })
    currentWorkflowStep = resolved.step
    if (resolved.stopped) {
      const loopError = "error" in resolved && typeof resolved.error === "string"
        ? resolved.error
        : "WORKFLOW_LOOP_STOPPED"
      return NextResponse.json(
        {
          ok: false,
          error: loopError,
          currentWorkflowStepKey: currentWorkflowStep ? stepKey(currentWorkflowStep) : null,
        },
        { status: 409 },
      )
    }
  }
  if (currentWorkflowStep && workflowAction && stepType(currentWorkflowStep) !== "gate") {
    return NextResponse.json(
      {
        ok: false,
        error: "WORKFLOW_ACTION_REQUIRES_GATE",
        currentWorkflowStepKey: stepKey(currentWorkflowStep),
        currentWorkflowStepType: stepType(currentWorkflowStep),
      },
      { status: 409 },
    )
  }
  const runnableWorkflowStep =
    currentWorkflowStep && stepType(currentWorkflowStep) === "gate"
      ? nextStepForAction(linkedWorkflowSteps, currentWorkflowStep, workflowAction)
      : currentWorkflowStep
  if (currentWorkflowStep && stepType(currentWorkflowStep) === "gate" && !runnableWorkflowStep) {
    return NextResponse.json(
      {
        ok: false,
        error: "workflow_runnable_step_not_found",
        currentWorkflowStepKey: stepKey(currentWorkflowStep),
        currentWorkflowStepType: stepType(currentWorkflowStep),
      },
      { status: 409 },
    )
  }
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
  const workflowRequestedCapabilities = requestedCapabilitiesFromAgentConfig(workflowAgentConfig)
    .map((key): GatewayCapabilityDescriptor => ({ key }))
  const interactiveCapabilities = actorType === "admin"
    ? await listInteractiveGatewayCapabilitiesOrEmpty("full")
    : []
  const requestedCapabilities = Array.from(new Map([
    ...workflowRequestedCapabilities,
    ...interactiveCapabilities,
  ].map((capability) => [capability.key, capability])).values())
  const workflowRequestedToolsets = requestedToolsetsFromAgentConfig(workflowAgentConfig).map((key) => ({ key }))
  const interactiveToolsets = actorType === "admin" ? await listEnabledGatewayToolsetsOrEmpty() : []
  const requestedToolsets = Array.from(new Map([
    ...workflowRequestedToolsets,
    ...interactiveToolsets,
  ].map((toolset) => [toolset.key, toolset])).values())

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

  const nextWorkflowStepAfterRun = runnableWorkflowStep
    ? nextStepForAction(linkedWorkflowSteps, runnableWorkflowStep, null)
    : null
  const runnableStepKey = runnableWorkflowStep ? stepKey(runnableWorkflowStep) : null
  const nextStepKeyAfterRun = nextWorkflowStepAfterRun ? stepKey(nextWorkflowStepAfterRun) : null
  let activeAgentRunId: string | null = providedAgentRunId

  if (
    activeLinkedChangeRequestId &&
    linkedChangeRequest &&
    linkedWorkflowRun &&
    currentWorkflowStep &&
    stepType(currentWorkflowStep) === "gate" &&
    runnableWorkflowStep &&
    runnableStepKey &&
    isTerminalWorkflowStep(runnableWorkflowStep)
  ) {
    const responseText = completeWorkflowGateStep({
      requestId: activeLinkedChangeRequestId,
      requestNumber: linkedChangeRequest.requestNumber,
      requestTitle: linkedChangeRequest.title,
      workflowRunId: linkedWorkflowRun.id,
      fromStep: currentWorkflowStep,
      toStep: runnableWorkflowStep,
      action: gateEventAction(workflowAction),
      actorType,
      note: latestUserMessage.content,
    })
    const updatedSession = updateAgentSession(session.id, {
      title: session.title ?? latestUserMessage.content.slice(0, 80),
      linkedChangeRequestId: activeLinkedChangeRequestId,
      linkedTargetEnvironmentId: activeLinkedTargetEnvironmentId,
      meta: {
        ...session.meta,
        transport: "site",
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
        workflowStepKey: runnableStepKey,
        workflowAction: gateEventAction(workflowAction),
      },
    })
    if (providedAgentRunId) {
      updateAgentRun(providedAgentRunId, {
        status: "succeeded",
        sessionId: session.id,
        requestId: activeLinkedChangeRequestId,
        workflowRunId: linkedWorkflowRun.id,
        workflowStepKey: runnableStepKey,
        result: { responseText },
        errorMessage: null,
        finishedAt: new Date().toISOString(),
      })
    }

    return NextResponse.json({
      id: assistantMessage?.id ?? randomUUID(),
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: "site-workflow",
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
        workflow_action: gateEventAction(workflowAction),
        workflow_step_key: runnableStepKey,
      },
      onProgress: recordRuntimeProgress,
    })
  }

  if (
    activeLinkedChangeRequestId &&
    linkedChangeRequest &&
    linkedWorkflowRun &&
    runnableWorkflowStep &&
    runnableStepKey
  ) {
    const runnableStepType = stepType(runnableWorkflowStep)
    if (runnableStepType !== "agent" && runnableStepType !== "checkpoint") {
      return NextResponse.json(
        { ok: false, error: "WORKFLOW_STEP_NOT_RUNNABLE" },
        { status: 409 },
      )
    }

    const idempotencyKey = workflowStepRunIdempotencyKey({
      requestId: activeLinkedChangeRequestId,
      workflowRunId: linkedWorkflowRun.id,
      stepKey: runnableStepKey,
      action: workflowAction,
      loopIterationKey: loopIterationKeyForRequest({
        requestId: activeLinkedChangeRequestId,
      }),
    })
    const existingAgentRun = findActiveAgentRunByIdempotencyKey(idempotencyKey)
    if (existingAgentRun && existingAgentRun.id !== providedAgentRunId) {
      return NextResponse.json(
        {
          ok: true,
          duplicate: true,
          reason: "AGENT_RUN_ALREADY_RUNNING",
          agentRun: existingAgentRun,
          idempotencyKey,
        },
        { status: 202 },
      )
    }

    if (hasActiveAgentRun(activeLinkedChangeRequestId, providedAgentRunId)) {
      return NextResponse.json(
        { ok: false, error: "AGENT_RUN_ACTIVE" },
        { status: 409 },
      )
    }

    if (currentWorkflowStep && stepType(currentWorkflowStep) === "gate") {
      createWorkflowEvent({
        workflowRunId: linkedWorkflowRun.id,
        requestId: activeLinkedChangeRequestId,
        stepKey: stepKey(currentWorkflowStep),
        eventType: `gate.${gateEventAction(workflowAction)}`,
        actorType,
        note: latestUserMessage.content,
          payload: {
            fromStepKey: stepKey(currentWorkflowStep),
            toStepKey: runnableStepKey,
          },
        })
    }

    activeAgentRunId = startWorkflowAgentStep({
      requestId: activeLinkedChangeRequestId,
      workflowRunId: linkedWorkflowRun.id,
      workflowKey: linkedChangeRequest.workflowKey,
      stepKey: runnableStepKey,
      sessionId: session.id,
      idempotencyKey,
      agentRunId: providedAgentRunId,
      action: workflowAction,
    })
    if (!activeAgentRunId) {
      return NextResponse.json(
        { ok: false, error: "AGENT_RUN_START_FAILED" },
        { status: 409 },
      )
    }
  }

  try {
    const runtimeResponse = await requestCodexRuntimeResponse({
      prompt: latestUserMessage.content,
      sessionId: session.id,
      codexThreadId: typeof session.meta?.codexThreadId === "string" ? session.meta.codexThreadId : null,
      recentHistory,
      capabilities: requestedCapabilities,
      toolsets: requestedToolsets,
      gatewayContext: {
        delegatedActorId: actorType === "admin" ? "admin-console" : undefined,
        requestId: activeLinkedChangeRequestId ?? undefined,
        workflowRunId: linkedWorkflowRun?.id ?? undefined,
        workflowStepKey: runnableStepKey ?? undefined,
      },
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
        linkedLatestAgentRun: linkedLatestAgentRun
          ? {
              id: linkedLatestAgentRun.id,
              status: linkedLatestAgentRun.status,
              workflowStepKey: linkedLatestAgentRun.workflowStepKey,
              result: linkedLatestAgentRun.result,
            }
          : null,
        linkedExternalRefs,
        linkedChangeRequest: linkedChangeRequest
          ? {
              id: linkedChangeRequest.id,
              requestNumber: linkedChangeRequest.requestNumber,
              title: linkedChangeRequest.title,
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
              activeAgentRunId ? `Current agent run id: ${activeAgentRunId}. When creating request artifacts for this step, include this as agent_run_id.` : null,
              workflowOutcomeInstruction(),
              isCheckpointWorkflowStep(runnableWorkflowStep)
                ? [
                    "This workflow step is a checkpoint. Check external state and durable artifacts without starting duplicate work.",
                    "The site will keep the request on this checkpoint after this run.",
                    nextStepKeyAfterRun ? `If the workflow is ready to continue, say that ${nextStepKeyAfterRun} should run next and why.` : null,
                  ].filter(Boolean).join(" ")
                : nextStepKeyAfterRun ? `When this step is complete, advance the workflow run to ${nextStepKeyAfterRun}.` : null,
              linkedChangeRequest
                ? `To read prior workflow artifact bodies, call GET /agent/change-board/requests/by-number/${linkedChangeRequest.requestNumber}/artifacts with x-service-token. Filter by name or kind when useful.`
                : null,
            ].filter(Boolean).join("\n\n")
          : null,
      },
    })

    const responseText = (runtimeResponse.responseText || runtimeResponse.output_text || "").trim()
    if (!responseText) {
      return NextResponse.json({ ok: false, error: "CODEX_RUNTIME_EMPTY_RESPONSE" }, { status: 502 })
    }
    const workflowOutcome = parseWorkflowOutcomeFromResponseText(responseText)

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

    if (activeLinkedChangeRequestId && linkedWorkflowRun && runnableStepKey) {
      const completedStepKey = completeWorkflowAgentStep({
            agentRunId: activeAgentRunId,
        runtimeResponse,
        responseText,
        requestId: activeLinkedChangeRequestId,
        stepKey: runnableStepKey,
        workflowRunId: linkedWorkflowRun.id,
        workflowKey: linkedChangeRequest?.workflowKey ?? null,
        nextStep: nextWorkflowStepAfterRun,
        linkedWorkflowSteps,
        sessionId: session.id,
      })
      if (!completedStepKey) {
        return NextResponse.json({
          ok: true,
          output_text: "The canceled workflow agent run returned after cancellation and was ignored.",
          session_id: updatedSession?.id ?? session.id,
        })
      }
    }

    const workflowRunAfterInitialStep =
      activeLinkedChangeRequestId && linkedWorkflowRun
        ? getWorkflowRunForRequest(activeLinkedChangeRequestId)
        : null
    const nextAutoContinueStep =
      workflowRunAfterInitialStep
        ? findStepByKey(linkedWorkflowSteps, workflowRunAfterInitialStep.currentStepKey)
        : nextWorkflowStepAfterRun
    const autoContinuedSteps: string[] = []
    if (
      autoContinueUntilGate &&
      !workflowOutcomeStopsAutoContinue(workflowOutcome) &&
      activeLinkedChangeRequestId &&
      linkedChangeRequest &&
      linkedWorkflowRun &&
      nextAutoContinueStep &&
      stepType(nextAutoContinueStep) === "agent"
    ) {
      let continuationStep: Record<string, unknown> | null = nextAutoContinueStep
      let continuationThreadId =
        runtimeResponse.thread_id ??
        (typeof session.meta?.codexThreadId === "string" ? session.meta.codexThreadId : null)
      let continuationHistory = [
        ...recentHistory,
        { role: "user", content: latestUserMessage.content },
        { role: "assistant", content: responseText },
      ].slice(-12)

      for (let autoIndex = 0; autoIndex < maxAutoContinueSteps() && continuationStep; autoIndex += 1) {
        const continuationStepKey = stepKey(continuationStep)
        if (!continuationStepKey || stepType(continuationStep) !== "agent") {
          break
        }

        const latestRequest = getChangeRequest(activeLinkedChangeRequestId) ?? linkedChangeRequest
        const latestRun = ensureWorkflowRunForRequest({
          requestId: activeLinkedChangeRequestId,
          workflowKey: linkedChangeRequest.workflowKey,
        })
        const continuationNextStep = nextStepForAction(linkedWorkflowSteps, continuationStep, null)
        const continuationNextStepKey = continuationNextStep ? stepKey(continuationNextStep) : null

        if (!latestRun) {
          break
        }

        if (hasActiveAgentRun(activeLinkedChangeRequestId, activeAgentRunId)) {
          break
        }

        const continuationIdempotencyKey = workflowStepRunIdempotencyKey({
          requestId: activeLinkedChangeRequestId,
          workflowRunId: latestRun.id,
          stepKey: continuationStepKey,
          action: null,
          loopIterationKey: loopIterationKeyForRequest({
            requestId: activeLinkedChangeRequestId,
          }),
        })
        if (findActiveAgentRunByIdempotencyKey(continuationIdempotencyKey)) {
          break
        }

        const continuationAgentRunId = startWorkflowAgentStep({
          requestId: activeLinkedChangeRequestId,
          workflowRunId: latestRun.id,
          workflowKey: linkedChangeRequest.workflowKey,
          stepKey: continuationStepKey,
          sessionId: session.id,
          idempotencyKey: continuationIdempotencyKey,
          autoContinued: true,
        })

        const continuationInstruction = readInstructionFile(continuationStep.instructionPath)
        const continuationAgentConfig = {
          ...(isRecord(linkedWorkflow?.definition?.agentConfig) ? linkedWorkflow.definition.agentConfig : {}),
          ...(isRecord(continuationStep?.agentConfig) ? continuationStep.agentConfig : {}),
        }
        const continuationRequestedSkills = Array.from(
          new Set([
            ...requestedSkills,
            ...requestedSkillsFromAgentConfig(continuationAgentConfig),
          ]),
        )
        const continuationCapabilities = requestedCapabilitiesFromAgentConfig(continuationAgentConfig)
        const continuationPrompt = [
          `Automatically continue workflow step ${continuationStepKey} for request #${latestRequest.requestNumber}: ${latestRequest.title}.`,
          `Step label: ${typeof continuationStep.label === "string" ? continuationStep.label : continuationStepKey}.`,
          continuationInstruction
            ? "Use the workflow step instructions from runtime metadata."
            : "Use the current workflow step instructions from runtime metadata and the request context.",
          "This is part of an auto-continue chain. Complete only this step, save durable outputs as request artifacts when appropriate, and return a concise summary.",
        ].join("\n")

        try {
          const continuationResponse = await requestCodexRuntimeResponse({
            prompt: continuationPrompt,
            sessionId: session.id,
            codexThreadId: continuationThreadId,
            recentHistory: continuationHistory,
            capabilities: continuationCapabilities,
            gatewayContext: {
              requestId: activeLinkedChangeRequestId,
              workflowRunId: latestRun.id,
              workflowStepKey: continuationStepKey,
            },
            metadata: {
              transport: "site",
              requestedSkills: continuationRequestedSkills,
              workflow: linkedWorkflow
                ? {
                    key: linkedWorkflow.key,
                    name: linkedWorkflow.name,
                    currentStepKey: continuationStepKey,
                    action: null,
                    agentConfig: continuationAgentConfig,
                    stepInstruction: continuationInstruction,
                    autoContinued: true,
                  }
                : null,
              linkedChangeRequestId: activeLinkedChangeRequestId,
              linkedTargetEnvironmentId: activeLinkedTargetEnvironmentId,
              linkedTargetApp,
              linkedTargetEnvironment,
              linkedDeployPlan,
              linkedLatestAgentRun: listAgentRuns({ requestId: activeLinkedChangeRequestId, limit: 1 })[0] ?? null,
              linkedExternalRefs: listRequestExternalRefs(activeLinkedChangeRequestId),
              linkedChangeRequest: {
                id: latestRequest.id,
                requestNumber: latestRequest.requestNumber,
                title: latestRequest.title,
                triageSummary: latestRequest.triageSummary,
                agentRecommendation: latestRequest.agentRecommendation,
                reviewNotes: latestRequest.reviewNotes,
              },
              linkedChangeRequestInstruction: [
                continuationInstruction
                  ? `Workflow step instructions:\n${continuationInstruction}`
                  : "This response is linked to a tracked request workflow step.",
                `Current workflow step: ${continuationStepKey}.`,
                continuationAgentRunId ? `Current agent run id: ${continuationAgentRunId}. When creating request artifacts for this step, include this as agent_run_id.` : null,
                workflowOutcomeInstruction(),
                continuationNextStepKey ? `When this step is complete, advance the workflow run to ${continuationNextStepKey}.` : null,
                `To read prior workflow artifact bodies, call GET /agent/change-board/requests/by-number/${latestRequest.requestNumber}/artifacts with x-service-token. Filter by name or kind when useful.`,
                "Auto-continue is enabled; the site will run the next agent step until the workflow reaches a gate, checkpoint, or terminal step.",
              ].filter(Boolean).join("\n\n"),
            },
            onProgress: recordRuntimeProgress,
          })

          const continuationText = (continuationResponse.responseText || continuationResponse.output_text || "").trim()
          if (!continuationText) {
            throw new Error("CODEX_RUNTIME_EMPTY_RESPONSE")
          }
          const continuationOutcome = parseWorkflowOutcomeFromResponseText(continuationText)

          continuationThreadId = continuationResponse.thread_id ?? continuationThreadId
          updateAgentSession(session.id, {
            linkedChangeRequestId: activeLinkedChangeRequestId,
            linkedTargetEnvironmentId: activeLinkedTargetEnvironmentId,
            meta: {
              ...session.meta,
              transport: "site",
              codexThreadId: continuationThreadId,
              codexProvider: continuationResponse.provider ?? "codex-cli",
            },
            lastMessageAt: new Date().toISOString(),
          })
          createAgentMessage({
            sessionId: session.id,
            role: "assistant",
            source: "site",
            sourceMessageId: null,
            content: continuationText,
            meta: {
              transport: "site",
              codexThreadId: continuationThreadId,
              workflowStepKey: continuationStepKey,
              autoContinued: true,
            },
          })

          const completedContinuationStepKey = completeWorkflowAgentStep({
            runtimeResponse: continuationResponse,
            responseText: continuationText,
            requestId: activeLinkedChangeRequestId,
            stepKey: continuationStepKey,
            workflowRunId: latestRun.id,
            workflowKey: linkedChangeRequest.workflowKey,
            nextStep: continuationNextStep,
            linkedWorkflowSteps,
            sessionId: session.id,
            autoContinued: true,
            agentRunId: continuationAgentRunId,
          })
          if (!completedContinuationStepKey) {
            break
          }
          if (workflowOutcomeStopsAutoContinue(continuationOutcome)) {
            break
          }

          autoContinuedSteps.push(continuationStepKey)
          continuationHistory = [
            ...continuationHistory,
            { role: "user", content: continuationPrompt },
            { role: "assistant", content: continuationText },
          ].slice(-12)
          const runAfterContinuation = getWorkflowRunForRequest(activeLinkedChangeRequestId)
          const resolvedContinuationStep =
            runAfterContinuation
              ? findStepByKey(linkedWorkflowSteps, runAfterContinuation.currentStepKey)
              : continuationNextStep
          continuationStep =
            resolvedContinuationStep && stepType(resolvedContinuationStep) === "agent"
              ? resolvedContinuationStep
              : null
        } catch (continuationError) {
          const continuationMessage =
            continuationError instanceof Error ? continuationError.message : "CODEX_RUNTIME_REQUEST_FAILED"
          const runtimeContinuationError = continuationError as RuntimeError
          const failureTrace = Array.isArray(runtimeContinuationError.trace) ? runtimeContinuationError.trace : []
          const failureSummary = formatTraceSummary(failureTrace)
          if (continuationAgentRunId) {
            updateAgentRun(continuationAgentRunId, {
              status: "failed",
              result: failedWorkflowAgentRunResult({
                runtimeError: runtimeContinuationError,
                latestAgentRun: listAgentRuns({ requestId: activeLinkedChangeRequestId, limit: 1 })[0] ?? null,
                workflowKey: linkedChangeRequest.workflowKey,
                workflowRunId: latestRun.id,
                workflowStepKey: continuationStepKey,
                sessionId: session.id,
              }),
              trace: failureTrace,
              errorMessage: continuationMessage,
              leaseExpiresAt: null,
              queueReason: null,
              finishedAt: new Date().toISOString(),
            })
          }
          createWorkflowEvent({
            workflowRunId: latestRun.id,
            requestId: activeLinkedChangeRequestId,
            stepKey: continuationStepKey,
            eventType: "agent.failed",
            actorType: "codex",
            note: continuationMessage,
            payload: {
              agentRunId: continuationAgentRunId,
              autoContinued: true,
              runtimeTrace: failureTrace,
            },
          })
          createAgentMessage({
            sessionId: session.id,
            role: "assistant",
            source: "site",
            sourceMessageId: null,
            content: failureSummary
              ? `Auto-continue failed at ${continuationStepKey}: ${continuationMessage}\n\nRecent execution trace:\n${failureSummary}`
              : `Auto-continue failed at ${continuationStepKey}: ${continuationMessage}`,
            meta: {
              transport: "site",
              error: true,
              workflowStepKey: continuationStepKey,
              autoContinued: true,
              runtimeTrace: failureTrace,
            },
          })
          break
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
        auto_continued_steps: autoContinuedSteps,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "CODEX_RUNTIME_REQUEST_FAILED"
    const runtimeError = error as RuntimeError
    const failureTrace = Array.isArray(runtimeError.trace) ? runtimeError.trace : []
    const failureSummary = formatTraceSummary(failureTrace)
    const activeAgentRunWasStopped =
      Boolean(activeAgentRunId) &&
      isStoppedAgentRunStatus(getAgentRun(activeAgentRunId!)?.status)

    if (activeLinkedChangeRequestId && linkedChangeRequest && linkedWorkflowRun && runnableStepKey) {
      if (
        activeAgentRunId &&
        !activeAgentRunWasStopped
      ) {
        updateAgentRun(activeAgentRunId, {
          status: "failed",
          result: failedWorkflowAgentRunResult({
            runtimeError,
            latestAgentRun: linkedLatestAgentRun,
            workflowKey: linkedChangeRequest.workflowKey,
            workflowRunId: linkedWorkflowRun.id,
            workflowStepKey: runnableStepKey,
            sessionId: session.id,
          }),
          trace: failureTrace,
          errorMessage: message,
          leaseExpiresAt: null,
          queueReason: null,
          finishedAt: new Date().toISOString(),
        })
      }

      createWorkflowEvent({
        workflowRunId: linkedWorkflowRun.id,
        requestId: activeLinkedChangeRequestId,
        stepKey: runnableStepKey,
        eventType: activeAgentRunWasStopped ? "agent.failure_ignored" : "agent.failed",
        actorType: activeAgentRunWasStopped ? "system" : "codex",
        note: activeAgentRunWasStopped
          ? "Ignored a late runtime failure because the agent run was stopped before the runtime returned."
          : message,
        payload: {
          agentRunId: activeAgentRunId,
          runtimeTrace: failureTrace,
        },
      })
      if (!activeAgentRunWasStopped) {
        updateChangeRequest(activeLinkedChangeRequestId, {
          workflowStepKey: runnableStepKey,
        })
      }
    }

    if (activeAgentRunWasStopped) {
      return NextResponse.json({
        ok: true,
        output_text: "The stopped workflow agent run returned after it was canceled or superseded and was ignored.",
        session_id: session.id,
      })
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
