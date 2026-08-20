import assert from "node:assert/strict"
import test from "node:test"

import type { LabRequestListItem } from "./contracts"
import { buildCrossRequestActivity } from "./activity-read-model"

function request(overrides: Partial<LabRequestListItem>): LabRequestListItem {
  return {
    id: "request-1", requestNumber: 1, title: "Request", description: "", requestType: "change-request",
    priority: "normal", workflowKey: "default", lifecycle: "open",
    phase: { key: "work", label: "Work", type: "agent", known: true },
    source: { key: "site", label: "Site", raw: "site", known: true },
    run: { status: null, active: false, activeCount: 0, failed: false, workflowStatus: null, workflowActive: false },
    attention: { required: false, blocked: false, status: null, summary: null, suggestedFix: null, blockerCount: 0 },
    hasHumanGate: false, estimatedHumanHours: null, estimatedHumanHoursLabel: null, requestedByDisplayName: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    allowedActions: {} as LabRequestListItem["allowedActions"], searchText: "request", ...overrides,
  }
}

test("cross-request activity is newest first and attention takes precedence", () => {
  const items = buildCrossRequestActivity([
    request({ id: "older", requestNumber: 1 }),
    request({
      id: "attention", requestNumber: 2, updatedAt: "2026-01-02T00:00:00.000Z",
      run: { status: "running", active: true, activeCount: 1, failed: false, workflowStatus: "active", workflowActive: true },
      attention: { required: true, blocked: true, status: "blocked", summary: "Approval missing", suggestedFix: null, blockerCount: 1 },
    }),
  ])
  assert.equal(items[0]?.request.id, "attention")
  assert.equal(items[0]?.state, "attention")
  assert.equal(items[0]?.summary, "Approval missing")
})
