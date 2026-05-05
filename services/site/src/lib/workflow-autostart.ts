import type { ChangeRequestRecord } from "@/lib/app-core"
import {
  getChangeRequest,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  loadConfig,
} from "@/lib/app-core"
import { getInternalServiceToken } from "@/lib/internal-service"

type WorkflowAutoStartResult = {
  started: boolean
  reason?: string
  status?: number
  response?: unknown
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function workflowSteps(definition: unknown) {
  return isRecord(definition) && Array.isArray(definition.steps)
    ? definition.steps.filter(isRecord)
    : []
}

function stepKey(step: Record<string, unknown> | null | undefined) {
  return typeof step?.key === "string" && step.key.trim() ? step.key.trim() : null
}

function stepLabel(step: Record<string, unknown> | null | undefined) {
  return typeof step?.label === "string" && step.label.trim()
    ? step.label.trim()
    : stepKey(step) ?? "workflow step"
}

function stepType(step: Record<string, unknown> | null | undefined) {
  return typeof step?.type === "string" && step.type.trim() ? step.type.trim() : "agent"
}

function currentWorkflowStep(request: ChangeRequestRecord) {
  const workflow = getWorkflowByKey(request.workflowKey)
  const steps = workflowSteps(workflow?.definition)
  const run = getWorkflowRunForRequest(request.id)
  const currentStepKey = run?.currentStepKey ?? request.currentWorkflowStepKey
  if (currentStepKey) {
    const match = steps.find((step) => stepKey(step) === currentStepKey)
    if (match) return match
  }

  const entrypoint = isRecord(workflow?.definition) && typeof workflow.definition.entrypoint === "string"
    ? workflow.definition.entrypoint.trim()
    : ""
  if (entrypoint) {
    const match = steps.find((step) => stepKey(step) === entrypoint)
    if (match) return match
  }

  return steps[0] ?? null
}

function defaultBaseUrl() {
  return `http://127.0.0.1:${loadConfig().port}`
}

export async function autoStartWorkflowRequest(
  request: ChangeRequestRecord,
  options: { baseUrl?: string | null; requestedSkills?: string[] } = {},
): Promise<WorkflowAutoStartResult> {
  const freshRequest = getChangeRequest(request.id) ?? request
  const step = currentWorkflowStep(freshRequest)
  const key = stepKey(step)
  if (!step || !key) {
    return { started: false, reason: "workflow_step_not_found" }
  }
  if (stepType(step) !== "agent") {
    return { started: false, reason: "current_step_is_not_agent" }
  }

  const baseUrl = (options.baseUrl?.trim() || defaultBaseUrl()).replace(/\/+$/, "")
  const prompt = [
    `Run workflow step ${key} for request #${freshRequest.requestNumber}: ${freshRequest.title}.`,
    `Step label: ${stepLabel(step)}.`,
    typeof step.instructionPath === "string" && step.instructionPath.trim()
      ? `Use the workflow step instructions at ${step.instructionPath.trim()}.`
      : "Use the current workflow step instructions from runtime metadata.",
    "Use the request context and thread history. Return a concise summary of what changed or what should happen next.",
  ].join("\n")

  try {
    const response = await fetch(`${baseUrl}/admin/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": getInternalServiceToken(),
      },
      body: JSON.stringify({
        input: [{ role: "user", content: prompt }],
        linked_change_request_id: freshRequest.id,
        workflow_action: null,
        auto_continue_until_gate: true,
        requested_skills: options.requestedSkills ?? [],
      }),
    })
    const text = await response.text()
    let payload: unknown = text
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }
    if (!response.ok) {
      return {
        started: false,
        reason: "workflow_start_failed",
        status: response.status,
        response: payload,
      }
    }
    return { started: true, status: response.status, response: payload }
  } catch (error) {
    return {
      started: false,
      reason: "workflow_start_error",
      error: error instanceof Error ? error.message : "Unknown workflow start error",
    }
  }
}
