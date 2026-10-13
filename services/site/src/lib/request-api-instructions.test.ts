import assert from "node:assert/strict"
import test from "node:test"
import { requestApiInstructions } from "./request-api-instructions"

test("linked request instructions distinguish displayed number and ID for reads and writes", () => {
  const text = requestApiInstructions({
    requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    requestNumber: 3623,
    agentRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  })

  assert.match(text, /Request #3623 is the displayed number; its request ID is bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/)
  assert.match(text, /GET \/agent\/change-board\/requests\/by-number\/3623\/review/)
  assert.match(text, /GET \/agent\/change-board\/requests\/by-number\/3623\/artifacts/)
  assert.match(text, /POST \/agent\/change-board\/requests\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\/artifacts/)
  assert.doesNotMatch(text, /POST \/agent\/change-board\/requests\/by-number\/3623\/artifacts/)
  assert.match(text, /top-level agent_run_id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/)
  assert.match(text, /HTTP 201 with ok: true and an artifact\.id/)
  assert.match(text, /GET \/agent\/change-board\/requests\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\/artifacts\/<artifact\.id>\/content\?format=json/)
  assert.match(text, /If a required artifact is missing or unreadable.*blocked workflow-outcome/)
  assert.match(text, /x-service-token/)
})

test("instructions do not invent agent run provenance when none is available", () => {
  const text = requestApiInstructions({ requestId: "request-id", requestNumber: 12 })
  assert.doesNotMatch(text, /top-level agent_run_id:/)
  assert.match(text, /POST \/agent\/change-board\/requests\/request-id\/artifacts/)
})
