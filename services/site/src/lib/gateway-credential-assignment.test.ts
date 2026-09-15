import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProfileRecord } from "./app-core";
import { credentialsForSourceMode, trustedCredentialKeys } from "./gateway-credential-assignment";

const credentials = [{ key: "sendgrid" }, { key: "github" }];

test("full sources honor bound profile credential policy without changing legacy behavior", () => {
  const profile: AgentProfileRecord = {
    id: "restricted", key: "restricted", name: "Restricted", description: null, avatarUrl: null,
    accentColor: "#36E7FF", status: "active", systemKey: null,
    owner: { type: "workspace", userId: null, agentProfileId: null }, stewards: [], persona: {},
    runtimeProfileKey: null, modelTier: null, skills: [], memoryScope: {},
    authority: { credentialPolicy: "none" }, contextPolicy: {}, version: 1,
    createdByUserId: null, bindings: [], createdAt: "", updatedAt: "",
  };
  assert.deepEqual(credentialsForSourceMode("full", credentials, profile), []);
  profile.authority = { credentialPolicy: "allowlist", gatewayCredentials: ["github", "not-enabled"] };
  assert.deepEqual(credentialsForSourceMode("full", credentials, profile), [{ key: "github" }]);
  profile.authority = { credentialPolicy: "allowlist", gatewayCredentials: [] };
  assert.deepEqual(credentialsForSourceMode("full", credentials, profile), []);
  profile.authority = { credentialPolicy: "all" };
  assert.deepEqual(credentialsForSourceMode("full", credentials, profile), credentials);
  assert.deepEqual(credentialsForSourceMode("readonly", credentials, profile), []);
  assert.deepEqual(credentialsForSourceMode("run-approved", credentials, profile), []);
  assert.deepEqual(credentialsForSourceMode("full", credentials, null), credentials);
});

test("only full-access source contexts receive credentials", () => {
  assert.deepEqual(credentialsForSourceMode("full", credentials), credentials);
  assert.deepEqual(credentialsForSourceMode("readonly", credentials), []);
  assert.deepEqual(credentialsForSourceMode("run-approved", credentials), []);
  assert.deepEqual(credentialsForSourceMode("off", credentials), []);
});

test("trusted credential assignments are stable and deduplicated", () => {
  assert.deepEqual(trustedCredentialKeys([...credentials, { key: "sendgrid" }]), ["sendgrid", "github"]);
});
