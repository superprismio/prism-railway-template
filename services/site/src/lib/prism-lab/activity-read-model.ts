import type { LabRequestListItem } from "./contracts"

export type LabCrossRequestActivity = {
  request: LabRequestListItem
  occurredAt: string
  state: "attention" | "running" | "completed" | "updated"
  summary: string
}
export function buildCrossRequestActivity(requests: LabRequestListItem[]): LabCrossRequestActivity[] {
  return requests
    .map((request): LabCrossRequestActivity => {
      if (request.attention.required) {
        return {
          request,
          occurredAt: request.updatedAt,
          state: "attention",
          summary: request.attention.summary || (request.attention.blocked ? "Workflow is blocked" : "Workflow needs attention"),
        }
      }
      if (request.run.active) {
        return {
          request,
          occurredAt: request.updatedAt,
          state: "running",
          summary: `${request.run.activeCount} active agent run${request.run.activeCount === 1 ? "" : "s"}`,
        }
      }
      if (request.lifecycle === "completed") {
        return { request, occurredAt: request.updatedAt, state: "completed", summary: "Request reached a terminal state" }
      }
      return { request, occurredAt: request.updatedAt, state: "updated", summary: `Current phase: ${request.phase.label}` }
    })
    .sort((left, right) => {
      const time = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
      return time || right.request.requestNumber - left.request.requestNumber
    })
}
