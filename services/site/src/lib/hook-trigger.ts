import {
  buildRequestArtifactStoragePath,
  createChangeRequest,
  createRequestArtifact,
  createWorkflowEvent,
  getDefaultTargetEnvironmentForApp,
  getHookByKey,
  getTargetApp,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  markHookTriggered,
  writeRequestArtifactFile,
  type HookRecord,
} from "@/lib/app-core"
import { randomUUID } from "node:crypto"
import { autoStartWorkflowRequest } from "@/lib/workflow-autostart"

type HookTriggerResult = {
  hook: HookRecord
  changeRequest: NonNullable<ReturnType<typeof createChangeRequest>>
  autoStart: Awaited<ReturnType<typeof autoStartWorkflowRequest>> | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function boolValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback
}

function templateValue(payload: Record<string, unknown>, key: string) {
  if (key === "payload") {
    return JSON.stringify(payload)
  }
  if (key === "date") {
    return new Date().toISOString().slice(0, 10)
  }
  if (key === "now") {
    return new Date().toISOString()
  }
  const value = payload[key]
  if (value === undefined || value === null) {
    return ""
  }
  return typeof value === "string" ? value : JSON.stringify(value)
}

function renderTemplate(template: unknown, payload: Record<string, unknown>, fallback = "") {
  const raw = stringValue(template, fallback)
  return raw.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => templateValue(payload, key))
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

async function writeHookPayloadArtifact(hook: HookRecord, requestId: string, payload: Record<string, unknown>) {
  const artifactId = randomUUID()
  const name = "hook-payload.json"
  const content = Buffer.from(JSON.stringify({
    hook: {
      key: hook.key,
      name: hook.name,
      workflowKey: hook.workflowKey,
    },
    payload,
    receivedAt: new Date().toISOString(),
  }, null, 2), "utf8")
  const storagePath = buildRequestArtifactStoragePath({ requestId, artifactId, name })

  await writeRequestArtifactFile(storagePath, content)
  const workflowRun = getWorkflowRunForRequest(requestId)
  const artifact = createRequestArtifact({
    id: artifactId,
    requestId,
    workflowRunId: workflowRun?.id ?? null,
    kind: "hook-payload",
    name,
    description: `Payload received by hook ${hook.key}.`,
    mimeType: "application/json",
    storagePath,
    sizeBytes: content.byteLength,
    metadata: {
      hookKey: hook.key,
      source: `hook:${hook.key}`,
    },
    createdBy: "hook",
  })

  if (workflowRun) {
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId,
      stepKey: workflowRun.currentStepKey,
      eventType: "artifact.created",
      actorType: "hook",
      payload: {
        artifactId: artifact.id,
        kind: artifact.kind,
        name: artifact.name,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
      },
    })
  }

  return artifact
}

export async function triggerHook(
  hookKey: string,
  payload: Record<string, unknown>,
  options: { baseUrl?: string | null; source?: string } = {},
): Promise<HookTriggerResult> {
  const hook = getHookByKey(hookKey)
  if (!hook) {
    throw new Error("HOOK_NOT_FOUND")
  }
  if (!hook.enabled) {
    throw new Error("HOOK_DISABLED")
  }

  const workflow = getWorkflowByKey(hook.workflowKey)
  if (!workflow) {
    throw new Error("WORKFLOW_NOT_FOUND")
  }
  if (!workflow.enabled) {
    throw new Error("WORKFLOW_DISABLED")
  }

  const requestTemplate = hook.requestTemplate
  const targetAppId = stringValue(requestTemplate.targetAppId ?? payload.targetAppId)
  const targetApp = targetAppId ? getTargetApp(targetAppId) : null
  if (targetAppId && (!targetApp || !targetApp.agentEnabled)) {
    throw new Error("TARGET_APP_INACTIVE")
  }
  const targetEnvironmentId =
    stringValue(requestTemplate.targetEnvironmentId ?? payload.targetEnvironmentId) ||
    (targetAppId ? getDefaultTargetEnvironmentForApp(targetAppId)?.id ?? "" : "")
  const constraints = isRecord(requestTemplate.constraints) ? requestTemplate.constraints : {}
  const payloadConstraints = isRecord(payload.constraints) ? payload.constraints : {}
  const attachments = Array.isArray(requestTemplate.attachments) ? requestTemplate.attachments : []

  const changeRequest = createChangeRequest({
    title: renderTemplate(requestTemplate.titleTemplate ?? requestTemplate.title, payload, `${hook.name} - {{date}}`),
    description: renderTemplate(
      requestTemplate.descriptionTemplate ?? requestTemplate.description,
      payload,
      `Triggered by hook ${hook.key}.\n\nPayload:\n{{payload}}`,
    ),
    workflowKey: hook.workflowKey,
    requestType: stringValue(requestTemplate.requestType ?? payload.requestType, "content"),
    priority: stringValue(requestTemplate.priority ?? payload.priority, "normal"),
    source: options.source ?? `hook:${hook.key}`,
    requestedByUserId: null,
    targetAppId: targetAppId || null,
    targetEnvironmentId: targetEnvironmentId || null,
    triageSummary: null,
    acceptanceCriteria: Array.isArray(requestTemplate.acceptanceCriteria) ? requestTemplate.acceptanceCriteria : [],
    constraints: {
      ...constraints,
      ...payloadConstraints,
      hook: {
        key: hook.key,
        payload,
      },
    },
    attachments,
    agentRecommendation: stringValue(requestTemplate.agentRecommendation),
  })

  if (!changeRequest) {
    throw new Error("HOOK_REQUEST_CREATE_FAILED")
  }

  let autoStart: Awaited<ReturnType<typeof autoStartWorkflowRequest>> | null = null
  const autoRunEnabled = boolValue(hook.autoRun.enabled, false)
  const requestedSkills = stringArray(hook.autoRun.requestedSkills)
  try {
    await writeHookPayloadArtifact(hook, changeRequest.id, payload)
  } catch (error) {
    console.warn(JSON.stringify({
      event: "hook.payload_artifact_failed",
      hookKey: hook.key,
      requestId: changeRequest.id,
      error: error instanceof Error ? error.message : "Unknown payload artifact error",
    }))
  }

  if (autoRunEnabled) {
    try {
      autoStart = await autoStartWorkflowRequest(changeRequest, { baseUrl: options.baseUrl, requestedSkills })
    } catch (error) {
      console.warn(JSON.stringify({
        event: "hook.autostart_failed",
        hookKey: hook.key,
        requestId: changeRequest.id,
        error: error instanceof Error ? error.message : "Unknown workflow autostart error",
      }))
    }
  }
  markHookTriggered(hook.key)

  return {
    hook: getHookByKey(hook.key) ?? hook,
    changeRequest,
    autoStart,
  }
}
