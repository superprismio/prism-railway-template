import fs from "node:fs"

import {
  createWorkflowEvent,
  getWorkflowRunForRequest,
  listRequestArtifacts,
  resolveRequestArtifactStoragePath,
  updateChangeRequest,
  updateWorkflowRun,
} from "@/lib/app-core"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stepKey(step: Record<string, unknown>) {
  return typeof step.key === "string" ? step.key.trim() : ""
}

function stepType(step: Record<string, unknown>) {
  return typeof step.type === "string" && step.type.trim() ? step.type.trim() : "agent"
}

function findStepByKey(steps: Record<string, unknown>[], key: string | null | undefined) {
  return steps.find((step) => stepKey(step) === key) ?? null
}

export function isLoopWorkflowStep(step: Record<string, unknown> | null | undefined) {
  return step ? stepType(step) === "loop" : false
}

function isTerminalWorkflowStep(step: Record<string, unknown> | null | undefined) {
  return step ? stepType(step) === "terminal" : false
}

function loopConfig(step: Record<string, unknown>) {
  return isRecord(step.loop) ? step.loop : {}
}

function loopString(step: Record<string, unknown>, key: string) {
  const value = loopConfig(step)[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function loopPositiveInteger(step: Record<string, unknown>, key: string) {
  const value = Number(loopConfig(step)[key])
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null
}

function workflowRunString(meta: Record<string, unknown> | null | undefined, key: string) {
  const value = meta?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function workflowRunNumber(meta: Record<string, unknown> | null | undefined, key: string) {
  const value = Number(meta?.[key])
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null
}

function workflowRunLoopIterations(meta: Record<string, unknown>, loopStepKey: string) {
  const loopIterations = isRecord(meta.loopIterations) ? meta.loopIterations : {}
  const value = loopIterations[loopStepKey]
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.trunc(Number(value)) : 0
}

function nextWorkflowRunLoopMeta(meta: Record<string, unknown>, loopStepKey: string, iteration: number) {
  const loopIterations = isRecord(meta.loopIterations) ? meta.loopIterations : {}
  return {
    ...meta,
    loopIterations: {
      ...loopIterations,
      [loopStepKey]: iteration,
    },
  }
}

export function loopIterationKeyForRequest(input: {
  requestId: string
  loopStepKey?: string | null
}) {
  const run = getWorkflowRunForRequest(input.requestId)
  const loopStepKey = input.loopStepKey ?? workflowRunString(run?.meta, "lastLoopStepKey")
  const iteration = workflowRunNumber(run?.meta, "lastLoopIteration")
  if (!loopStepKey || !iteration) {
    return null
  }
  return `loop-${loopStepKey}-${iteration}`
}

function checklistCounts(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return { counts: null, error: "LOOP_CHECKLIST_INVALID" }
  }

  const counts = {
    pending: 0,
    in_progress: 0,
    complete: 0,
    blocked: 0,
    skipped: 0,
    total: 0,
  }

  for (const item of payload.items) {
    if (!isRecord(item)) {
      return { counts: null, error: "LOOP_CHECKLIST_INVALID" }
    }
    const status = typeof item.status === "string" ? item.status.trim() : ""
    if (status === "pending") counts.pending += 1
    else if (status === "in_progress") counts.in_progress += 1
    else if (status === "complete") counts.complete += 1
    else if (status === "blocked") counts.blocked += 1
    else if (status === "skipped") counts.skipped += 1
    else return { counts: null, error: "LOOP_CHECKLIST_INVALID" }
    counts.total += 1
  }

  return { counts, error: null }
}

function readLoopChecklistArtifact(input: { requestId: string; artifactName: string }) {
  const artifact = listRequestArtifacts(input.requestId, 500).find((candidate) => candidate.name === input.artifactName)
  if (!artifact) {
    return { artifact: null, payload: null, error: "LOOP_ARTIFACT_NOT_FOUND" }
  }

  try {
    const body = fs.readFileSync(resolveRequestArtifactStoragePath(artifact.storagePath), "utf8")
    return { artifact, payload: JSON.parse(body) as unknown, error: null }
  } catch (error) {
    return {
      artifact,
      payload: null,
      error: error instanceof SyntaxError ? "LOOP_ARTIFACT_INVALID_JSON" : "LOOP_ARTIFACT_READ_FAILED",
    }
  }
}

function failLoopEvaluation(input: {
  requestId: string
  workflowRunId: string
  loopStepKey: string
  artifactName: string | null
  error: string
  autoContinued?: boolean
}) {
  updateChangeRequest(input.requestId, {
    workflowStepKey: input.loopStepKey,
  })
  updateWorkflowRun({
    requestId: input.requestId,
    currentStepKey: input.loopStepKey,
    status: "active",
    completedAt: null,
  })
  createWorkflowEvent({
    workflowRunId: input.workflowRunId,
    requestId: input.requestId,
    stepKey: input.loopStepKey,
    eventType: "loop.evaluation_failed",
    actorType: "system",
    note: input.error,
    payload: {
      loopStepKey: input.loopStepKey,
      artifactName: input.artifactName,
      autoContinued: input.autoContinued === true,
    },
  })
}

function resolveLoopStep(input: {
  requestId: string
  workflowRunId: string
  steps: Record<string, unknown>[]
  loopStep: Record<string, unknown>
  autoContinued?: boolean
}) {
  const loopStepKey = stepKey(input.loopStep)
  const artifactName = loopString(input.loopStep, "artifactName")
  const condition = loopString(input.loopStep, "condition")
  const targetStepKey = loopString(input.loopStep, "target")
  const maxIterations = loopPositiveInteger(input.loopStep, "maxIterations")
  const exitStepKey = typeof input.loopStep.next === "string" && input.loopStep.next.trim() ? input.loopStep.next.trim() : null
  const onMaxIterationsStepKey = loopString(input.loopStep, "onMaxIterations")

  if (!artifactName || condition !== "all_items_complete" || !targetStepKey || !maxIterations || !exitStepKey) {
    failLoopEvaluation({
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      loopStepKey,
      artifactName,
      error: "LOOP_CONFIG_INVALID",
      autoContinued: input.autoContinued,
    })
    return { step: input.loopStep, stopped: true, error: "LOOP_CONFIG_INVALID" }
  }

  const targetStep = findStepByKey(input.steps, targetStepKey)
  const exitStep = findStepByKey(input.steps, exitStepKey)
  const onMaxIterationsStep = onMaxIterationsStepKey ? findStepByKey(input.steps, onMaxIterationsStepKey) : null
  if (!targetStep || !exitStep || (onMaxIterationsStepKey && !onMaxIterationsStep)) {
    failLoopEvaluation({
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      loopStepKey,
      artifactName,
      error: "LOOP_ROUTE_NOT_FOUND",
      autoContinued: input.autoContinued,
    })
    return { step: input.loopStep, stopped: true, error: "LOOP_ROUTE_NOT_FOUND" }
  }

  const { artifact, payload, error } = readLoopChecklistArtifact({ requestId: input.requestId, artifactName })
  const checklist = error ? { counts: null, error } : checklistCounts(payload)
  if (checklist.error || !checklist.counts) {
    failLoopEvaluation({
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      loopStepKey,
      artifactName,
      error: checklist.error ?? "LOOP_CHECKLIST_INVALID",
      autoContinued: input.autoContinued,
    })
    return { step: input.loopStep, stopped: true, error: checklist.error ?? "LOOP_CHECKLIST_INVALID" }
  }

  const workflowRun = getWorkflowRunForRequest(input.requestId)
  const currentIteration = workflowRunLoopIterations(workflowRun?.meta ?? {}, loopStepKey)
  const counts = checklist.counts
  const complete = counts.pending === 0 && counts.in_progress === 0 && counts.blocked === 0
  const maxReached = !complete && currentIteration >= maxIterations
  const decision = complete ? "exit" : maxReached ? "max_iterations" : "continue"
  const nextStep = complete ? exitStep : maxReached ? onMaxIterationsStep ?? input.loopStep : targetStep
  const nextStepKey = stepKey(nextStep)
  const nextIteration = decision === "continue" ? currentIteration + 1 : currentIteration
  const nextMeta = nextWorkflowRunLoopMeta(workflowRun?.meta ?? {}, loopStepKey, nextIteration)

  updateChangeRequest(input.requestId, {
    workflowStepKey: nextStepKey,
  })
  updateWorkflowRun({
    requestId: input.requestId,
    currentStepKey: nextStepKey,
    status: isTerminalWorkflowStep(nextStep) ? "completed" : "active",
    completedAt: isTerminalWorkflowStep(nextStep) ? new Date().toISOString() : null,
    meta: decision === "continue"
      ? {
          ...nextMeta,
          lastLoopStepKey: loopStepKey,
          lastLoopIteration: nextIteration,
        }
      : nextMeta,
  })
  createWorkflowEvent({
    workflowRunId: input.workflowRunId,
    requestId: input.requestId,
    stepKey: loopStepKey,
    eventType: decision === "exit" ? "loop.exited" : decision === "max_iterations" ? "loop.max_iterations" : "loop.continued",
    actorType: "system",
    payload: {
      loopStepKey,
      decision,
      fromStepKey: loopStepKey,
      toStepKey: nextStepKey,
      artifactId: artifact?.id ?? null,
      artifactName,
      iteration: nextIteration,
      maxIterations,
      counts,
      autoContinued: input.autoContinued === true,
    },
  })
  if (nextStepKey !== loopStepKey) {
    createWorkflowEvent({
      workflowRunId: input.workflowRunId,
      requestId: input.requestId,
      stepKey: nextStepKey,
      eventType: "workflow.step_changed",
      actorType: "system",
      payload: {
        previousStepKey: loopStepKey,
        nextStepKey,
        loopStepKey,
        loopDecision: decision,
        autoContinued: input.autoContinued === true,
      },
    })
  }

  return {
    step: nextStep,
    stopped: nextStepKey === loopStepKey,
    decision,
    loopStepKey,
    iteration: nextIteration,
  }
}

export function resolveControlFlowSteps(input: {
  requestId: string
  workflowRunId: string
  steps: Record<string, unknown>[]
  step: Record<string, unknown> | null
  autoContinued?: boolean
}) {
  let current = input.step
  for (let index = 0; index < 10 && current && isLoopWorkflowStep(current); index += 1) {
    const resolved = resolveLoopStep({
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      steps: input.steps,
      loopStep: current,
      autoContinued: input.autoContinued,
    })
    if (resolved.stopped) {
      return resolved
    }
    current = resolved.step
  }
  return { step: current, stopped: false }
}
