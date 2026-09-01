import assert from "node:assert/strict"
import test from "node:test"

import {
  filterGatewayCredentialKeysForProfile,
  resolveAgentProfileRuntimeScope,
} from "./agent-profile-runtime-scope"

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

test("profile Gateway credential allowlists cap workflow credentials", () => {
  const profile = {
    id: "reviewer", key: "code-review-agent", name: "Code Review Agent", description: null, avatarUrl: null,
    accentColor: "#36E7FF", status: "active" as const, systemKey: "code-review-agent",
    owner: { type: "workspace" as const, userId: null, agentProfileId: null }, stewards: [], persona: {},
    runtimeProfileKey: null, skills: [], memoryScope: {},
    authority: { credentialPolicy: "allowlist", gatewayCredentials: ["github"] }, contextPolicy: {}, version: 1,
    createdByUserId: null, bindings: [], createdAt: "", updatedAt: "",
  }
  assert.deepEqual(filterGatewayCredentialKeysForProfile(profile, ["portal", "github", "github"]), ["github"])
  assert.deepEqual(filterGatewayCredentialKeysForProfile(null, ["portal", "github"]), ["portal", "github"])
})

test("credential-free profiles receive no Gateway credentials", () => {
  const profile = {
    id: "verifier", key: "verification-agent", name: "Verification Agent", description: null, avatarUrl: null,
    accentColor: "#36E7FF", status: "active" as const, systemKey: "verification-agent",
    owner: { type: "agent" as const, userId: null, agentProfileId: "agent-profile-admin" }, stewards: [], persona: {},
    runtimeProfileKey: null, skills: [], memoryScope: {}, authority: { credentialPolicy: "none" },
    contextPolicy: {}, version: 1, createdByUserId: null, bindings: [], createdAt: "", updatedAt: "",
  }
  assert.deepEqual(filterGatewayCredentialKeysForProfile(profile, ["github", "portal"]), [])
})
