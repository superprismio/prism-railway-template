import assert from "node:assert/strict"
import test from "node:test"

import { resolveAgentProfileRuntimeScope } from "./agent-profile-runtime-scope"

test("assigned Agent Profile controls runtime identity, runtime, and skills", () => {
  const scope = resolveAgentProfileRuntimeScope({
    profile: {
      id: "profile-1", key: "research", name: "Research Agent", description: "Ground decisions in evidence.", avatarUrl: null, accentColor: "#36E7FF",
      status: "active", systemKey: null, owner: { type: "workspace", userId: null, agentProfileId: null }, stewards: [],
      persona: { name: "Rook", instructions: "Cite sources and state uncertainty." }, runtimeProfileKey: "careful-runtime",
      skills: ["research-reader"], memoryScope: { buckets: ["research"] }, authority: { maximumAccessMode: "readonly" },
      contextPolicy: { continuation: "session" }, version: 4, createdByUserId: null, bindings: [], createdAt: "", updatedAt: "",
    },
    assignedVersion: 3,
    executionMode: "worker",
    requestSkills: ["attachment-reader"],
    callerRuntimeProfileKey: "untrusted-runtime",
  })
  assert.equal(scope.runtimeProfileKey, "careful-runtime")
  assert.deepEqual(scope.skills, ["research-reader", "attachment-reader"])
  assert.match(scope.policyInstructions ?? "", /Rook/)
  assert.match(scope.policyInstructions ?? "", /Cite sources/)
  assert.match(scope.policyInstructions ?? "", /Research Agent.*research.*version 3/)
  assert.equal(scope.metadata?.version, 3)
})
