/** Trusted routing hints for an agent running a linked request step. */
export function requestApiInstructions(input: {
  requestId: string
  requestNumber: number
  agentRunId?: string | null
}) {
  const byNumber = `/agent/change-board/requests/by-number/${input.requestNumber}`
  const byId = `/agent/change-board/requests/${input.requestId}`

  return [
    `Request #${input.requestNumber} is the displayed number; its request ID is ${input.requestId}. Use the number only on /by-number/ routes and the ID on /requests/:id routes.`,
    `Use x-service-token: $PRISM_AGENT_SERVICE_TOKEN with $PRISM_AGENT_API_BASE_URL. Read request, workflow run, events, and prior agent runs with GET ${byNumber}/review; read prior artifact bodies with GET ${byNumber}/artifacts (filter by name or kind if useful).`,
    `For a durable output, POST ${byId}/artifacts with JSON fields kind, name, mimeType, encoding (utf8 for text or base64 for binary), and content. This write route requires the request ID, not the displayed number.`,
    `Confirm each required artifact POST returned HTTP 201 with ok: true and an artifact.id. Then read it back with GET ${byId}/artifacts/<artifact.id>/content?format=json (or GET ${byNumber}/artifacts filtered by name for text). If a required artifact is missing or unreadable, do not report completion: emit a blocked workflow-outcome with the failure so the workflow stays on this step.`,
    input.agentRunId
      ? `Include top-level agent_run_id: ${input.agentRunId} in artifact POST bodies so the artifact is linked to this run.`
      : null,
    "If the PRISM_* environment names are absent, check APP_API_BASE_URL and APP_API_SERVICE_TOKEN before treating the Site API as unavailable. Do not use browser admin routes from Codex Runtime.",
  ].filter(Boolean).join("\n")
}
