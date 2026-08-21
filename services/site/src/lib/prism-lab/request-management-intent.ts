export type RequestManagementStep = {
  key: string
  label: string
  type: string
}

export type RequestManagementIntent =
  | { kind: "cancel-request" }
  | { kind: "retry-step" }
  | { kind: "move-step"; targetStepKey: string }
  | null

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function cancelIntent(value: string) {
  return /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:cancel|close)(?:\s+(?:(?:this|the|current)\s+)?request)?(?:\s+(?:now|please))?[?.!]*$/i.test(value.trim())
}

function retryIntent(value: string) {
  return /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:(?:try|run)\s+(?:(?:this|current|the(?:\s+current)?)\s+)?(?:step\s+)?again|re-?try(?:\s+(?:(?:this|current|the(?:\s+current)?)\s+)?(?:step|run|request))?|re-?run(?:\s+(?:(?:this|current|the(?:\s+current)?)\s+)?(?:step|run))?)(?:\s+(?:now|please))?[?.!]*$/i.test(value.trim())
}

function moveTarget(value: string) {
  const match = value.trim().match(
    /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:move|send|change|set)\b[\s\S]*?\b(?:back\s+to|forward\s+to|to)\s+(.+?)[?.!]*$/i,
  )
  if (!match?.[1]) return null
  return normalized(match[1])
    .replace(/^the\s+/, "")
    .replace(/\s+(?:step|phase)(?:\s+(?:now|please))?$/, "")
    .replace(/\s+(?:now|please)$/, "")
    .trim()
}

export function resolveRequestManagementIntent(
  value: string,
  steps: RequestManagementStep[],
): RequestManagementIntent {
  if (cancelIntent(value)) return { kind: "cancel-request" }
  if (retryIntent(value)) return { kind: "retry-step" }
  const target = moveTarget(value)
  if (!target) return null

  const candidates = steps
    .filter((step) => step.type !== "terminal")
    .map((step) => ({
      step,
      names: Array.from(new Set([normalized(step.key), normalized(step.label)])),
    }))
    .filter(({ names }) => names.some((name) => name === target))

  return candidates.length === 1
    ? { kind: "move-step", targetStepKey: candidates[0]!.step.key }
    : null
}
