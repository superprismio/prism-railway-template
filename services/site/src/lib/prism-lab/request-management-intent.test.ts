import assert from "node:assert/strict"
import test from "node:test"

import { resolveRequestManagementIntent } from "./request-management-intent"

const steps = [
  { key: "work", label: "Work", type: "agent" },
  { key: "approve-for-work", label: "Approve", type: "gate" },
  { key: "pr-review", label: "PR Review", type: "checkpoint" },
  { key: "closed", label: "Closed", type: "terminal" },
]

test("clear request cancellation commands resolve without model authority", () => {
  assert.deepEqual(resolveRequestManagementIntent("can you cancel this request", steps), {
    kind: "cancel-request",
  })
  assert.deepEqual(resolveRequestManagementIntent("Please close the request now.", steps), {
    kind: "cancel-request",
  })
  assert.deepEqual(resolveRequestManagementIntent("can you cancel now?", steps), {
    kind: "cancel-request",
  })
  assert.equal(resolveRequestManagementIntent("Can you explain how cancellation works?", steps), null)
})

test("clear retry commands resolve without model authority", () => {
  for (const command of [
    "try again",
    "please retry",
    "retry this step",
    "can you rerun the current step?",
    "run this step again now",
  ]) {
    assert.deepEqual(resolveRequestManagementIntent(command, steps), { kind: "retry-step" })
  }
  assert.equal(resolveRequestManagementIntent("Can you explain whether retrying is safe?", steps), null)
  assert.equal(resolveRequestManagementIntent("What happened when it tried again?", steps), null)
})

test("clear step movement commands resolve only exact nonterminal workflow steps", () => {
  assert.deepEqual(resolveRequestManagementIntent("move back to work", steps), {
    kind: "move-step",
    targetStepKey: "work",
  })
  assert.deepEqual(resolveRequestManagementIntent("Can you move this request forward to PR Review?", steps), {
    kind: "move-step",
    targetStepKey: "pr-review",
  })
  assert.equal(resolveRequestManagementIntent("move to review", steps), null)
  assert.equal(resolveRequestManagementIntent("move to closed", steps), null)
})
