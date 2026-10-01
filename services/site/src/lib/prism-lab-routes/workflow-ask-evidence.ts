import fs from "node:fs"
import path from "node:path"

const MAX_INSTRUCTION_BYTES = 64 * 1024
const MAX_INSTRUCTION_CHARS = 6_000
const MAX_INSTRUCTION_STEPS = 4
const MAX_WORKFLOW_STEPS = 40

export type InstructionEvidence = {
  status: "available" | "missing" | "rejected" | "oversize"
  content?: string
  truncated?: boolean
}

type Workflow = {
  key?: string
  name?: string
  version?: number
  updatedAt?: string
  definition?: { agentConfig?: Record<string, unknown>; steps?: Array<Record<string, unknown>> }
}

function within(candidate: string, root: string) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

/** Reads only workflow files under the configured site or data roots. */
export function loadWorkflowInstructionEvidence(
  instructionPath: string,
  roots: { workspaceRoot: string; repoRoot: string; dataRoot: string },
): InstructionEvidence {
  const raw = instructionPath.trim()
  if (!raw || raw.includes("\0")) return { status: "rejected" }
  const configuredRoots = [
    path.resolve(roots.workspaceRoot, "workflows"),
    path.resolve(roots.repoRoot, "services/site/workflows"),
    path.resolve(roots.dataRoot, "workflows"),
  ]
  const candidates = path.isAbsolute(raw)
    ? [path.resolve(raw)]
    : [
        path.resolve(roots.workspaceRoot, raw),
        path.resolve(roots.workspaceRoot, "workflows", raw.replace(/^workflows\/+/, "")),
        path.resolve(roots.repoRoot, "services/site", raw),
      ]
  const allowed = candidates.filter((candidate) => configuredRoots.some((root) => within(candidate, root)))
  if (!allowed.length) return { status: "rejected" }
  for (const candidate of allowed) {
    try {
      const realFile = fs.realpathSync(candidate)
      const realRoots = configuredRoots.flatMap((root) => {
        try { return [fs.realpathSync(root)] } catch { return [] }
      })
      if (!realRoots.some((root) => within(realFile, root))) return { status: "rejected" }
      const fd = fs.openSync(realFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      try {
        // O_NOFOLLOW guards the final component. Verify the actual opened file as
        // well, since an intermediate directory could change after realpathSync.
        // If /proc is unavailable, fail closed rather than read an unverified fd.
        const openedFile = fs.realpathSync(`/proc/self/fd/${fd}`)
        if (!realRoots.some((root) => within(openedFile, root))) return { status: "rejected" }
        const stat = fs.fstatSync(fd)
        if (!stat.isFile()) return { status: "rejected" }
        if (stat.size > MAX_INSTRUCTION_BYTES) return { status: "oversize" }
        const buffer = Buffer.alloc(MAX_INSTRUCTION_BYTES + 1)
        let bytesRead = 0
        while (bytesRead < buffer.length) {
          const count = fs.readSync(fd, buffer, bytesRead, buffer.length - bytesRead, null)
          if (count === 0) break
          bytesRead += count
        }
        if (bytesRead > MAX_INSTRUCTION_BYTES) return { status: "oversize" }
        const content = buffer.toString("utf8", 0, bytesRead).trim()
        return {
          status: "available",
          content: content.slice(0, MAX_INSTRUCTION_CHARS),
          truncated: content.length > MAX_INSTRUCTION_CHARS,
        }
      } finally {
        fs.closeSync(fd)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      return { status: "rejected" }
    }
  }
  return { status: "missing" }
}

function boundedString(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 120)).filter(Boolean).slice(0, 20)
}

function safeConfig(value: unknown) {
  const config = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const contextPolicy = config.contextPolicy && typeof config.contextPolicy === "object" && !Array.isArray(config.contextPolicy)
    ? config.contextPolicy as Record<string, unknown> : {}
  return {
    skills: stringList(config.skills),
    gatewayCredentials: stringList(config.gatewayCredentials ?? config.gateway_credentials),
    modelTier: boundedString(config.modelTier),
    contextPolicy: {
      continuation: boundedString(contextPolicy.continuation),
      handoff: boundedString(contextPolicy.handoff),
    },
  }
}

export function buildWorkflowAskEvidence(
  workflow: Workflow | null,
  currentStepKey: string | null,
  loadInstruction?: (instructionPath: string) => InstructionEvidence,
) {
  if (!workflow) return null
  const defaults = safeConfig(workflow.definition?.agentConfig)
  const allSteps = Array.isArray(workflow.definition?.steps) ? workflow.definition.steps : []
  const prioritized = [...allSteps].sort((left, right) =>
    Number(right.key === currentStepKey) - Number(left.key === currentStepKey))
  const steps = prioritized.slice(0, MAX_WORKFLOW_STEPS).flatMap((step, index) => {
    const key = boundedString(step.key, 160)
    if (!key) return []
    const rawConfig = step.agentConfig && typeof step.agentConfig === "object" && !Array.isArray(step.agentConfig)
      ? step.agentConfig as Record<string, unknown> : {}
    const rawDefaults = workflow.definition?.agentConfig ?? {}
    const config = safeConfig({ ...rawDefaults, ...rawConfig })
    const instructionPath = boundedString(step.instructionPath, 1_000)
    return [{
      key,
      label: boundedString(step.label) ?? key,
      type: boundedString(step.type) ?? "unknown",
      next: boundedString(step.next, 160),
      isCurrentStep: key === currentStepKey,
      agentConfig: config,
      instruction: instructionPath ? {
        source: instructionPath,
        ...(index < MAX_INSTRUCTION_STEPS && loadInstruction
          ? loadInstruction(instructionPath)
          : { status: "not_loaded" as const }),
      } : { status: "not_configured" as const },
    }]
  })
  return {
    key: boundedString(workflow.key),
    name: boundedString(workflow.name),
    version: workflow.version,
    updatedAt: boundedString(workflow.updatedAt, 80),
    source: "current_workflow_definition" as const,
    currentStepKey,
    defaults,
    steps,
    omittedStepCount: Math.max(0, allSteps.length - MAX_WORKFLOW_STEPS),
  }
}
