import type { ChangeRequestRecord } from "@/lib/app-core"
import {
  createAgentRun,
  ensureWorkflowRunForRequest,
  findActiveAgentRunByIdempotencyKey,
  getAgentRun,
  getWorkflowByKey,
  updateAgentRun,
} from "@/lib/app-core"
import { handleResponsePost } from "@/lib/response-route-handler"

type EnqueueWorkflowAgentRunInput = {
  request: ChangeRequestRecord
  prompt: string
  workflowAction?: string | null
  autoContinueUntilGate?: boolean
  requestedSkills?: string[]
  baseUrl?: string | null
}

type EnqueueWorkflowAgentRunResult = {
  queued: boolean
  duplicate?: boolean
  reason?: string
  status?: number
  agentRun?: ReturnType<typeof getAgentRun>
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function workflowSteps(definition: unknown) {
  return isRecord(definition) && Array.isArray(definition.steps)
    ? definition.steps.filter(isRecord).filter((step) => typeof step.key === "string" && step.key.trim())
    : []
}

function stepKey(step: Record<string, unknown> | null | undefined) {
  return typeof step?.key === "string" && step.key.trim() ? step.key.trim() : null
}

function stepType(step: Record<string, unknown> | null | undefined) {
  return typeof step?.type === "string" && step.type.trim() ? step.type.trim() : "agent"
}

function findStepByKey(steps: Record<string, unknown>[], key: string | null | undefined) {
  return steps.find((step) => stepKey(step) === key) ?? null
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

function workflowStepRunIdempotencyKey(input: {
  requestId: string
  workflowRunId: string
  stepKey: string
  action?: string | null
}) {
  const actionKey = input.action && input.action.trim() ? input.action.trim() : "run"
  return `workflow:${input.requestId}:${input.workflowRunId}:${input.stepKey}:${actionKey}`
}

function defaultBaseUrl() {
  return "http://127.0.0.1"
}

async function executeQueuedWorkflowAgentRun(agentRunId: string, input: EnqueueWorkflowAgentRunInput) {
  try {
    const response = await handleResponsePost(
      new Request(new URL("/agent/responses", input.baseUrl?.trim() || defaultBaseUrl()), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: [{ role: "user", content: input.prompt }],
          linked_change_request_id: input.request.id,
          workflow_action: input.workflowAction ?? null,
          auto_continue_until_gate: input.autoContinueUntilGate === true,
          requested_skills: input.requestedSkills ?? [],
          agent_run_id: agentRunId,
        }),
      }),
      async () => ({ ok: true as const }),
    )
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      updateAgentRun(agentRunId, {
        status: "failed",
        errorMessage: text || `HTTP ${response.status}`,
        finishedAt: new Date().toISOString(),
      })
    }
  } catch (error) {
    updateAgentRun(agentRunId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "WORKFLOW_AGENT_RUN_FAILED",
      finishedAt: new Date().toISOString(),
    })
  }
}

export function enqueueWorkflowAgentRun(input: EnqueueWorkflowAgentRunInput): EnqueueWorkflowAgentRunResult {
  const workflow = getWorkflowByKey(input.request.workflowKey)
  const steps = workflowSteps(workflow?.definition)
  const workflowRun = ensureWorkflowRunForRequest({
    requestId: input.request.id,
    workflowKey: input.request.workflowKey,
  })
  const currentStep =
    findStepByKey(steps, workflowRun.currentStepKey) ??
    findStepByKey(steps, typeof workflow?.definition?.entrypoint === "string" ? workflow.definition.entrypoint : null)
  if (!currentStep) {
    return { queued: false, reason: "workflow_step_not_found", status: 409 }
  }
  if (input.workflowAction && stepType(currentStep) !== "gate") {
    return { queued: false, reason: "WORKFLOW_ACTION_REQUIRES_GATE", status: 409 }
  }
  if (!input.workflowAction && stepType(currentStep) === "gate") {
    return { queued: false, reason: "WORKFLOW_ACTION_REQUIRED", status: 409 }
  }

  const runnableStep = stepType(currentStep) === "gate"
    ? nextStepForAction(steps, currentStep, input.workflowAction ?? "approved")
    : currentStep
  const runnableStepKey = stepKey(runnableStep)
  if (!runnableStep || !runnableStepKey) {
    return { queued: false, reason: "workflow_runnable_step_not_found", status: 409 }
  }
  const runnableStepType = stepType(runnableStep)
  if (runnableStepType === "terminal") {
    return { queued: false, reason: "WORKFLOW_ALREADY_TERMINAL", status: 409 }
  }
  if (runnableStepType !== "agent" && runnableStepType !== "checkpoint") {
    return { queued: false, reason: "WORKFLOW_STEP_NOT_RUNNABLE", status: 409 }
  }

  const idempotencyKey = workflowStepRunIdempotencyKey({
    requestId: input.request.id,
    workflowRunId: workflowRun.id,
    stepKey: runnableStepKey,
    action: input.workflowAction ?? null,
  })
  const existing = findActiveAgentRunByIdempotencyKey(idempotencyKey)
  if (existing) {
    return { queued: true, duplicate: true, status: 202, agentRun: existing }
  }

  const agentRun = createAgentRun({
    kind: "workflow_step",
    status: "queued",
    idempotencyKey,
    requestId: input.request.id,
    workflowRunId: workflowRun.id,
    workflowStepKey: runnableStepKey,
    source: "site",
    input: {
      prompt: input.prompt,
      workflowAction: input.workflowAction ?? null,
      autoContinueUntilGate: input.autoContinueUntilGate === true,
      requestedSkills: input.requestedSkills ?? [],
    },
  })
  if (!agentRun) {
    return { queued: false, reason: "AGENT_RUN_CREATE_FAILED", status: 500 }
  }

  void executeQueuedWorkflowAgentRun(agentRun.id, input)
  return { queued: true, status: 202, agentRun }
}
