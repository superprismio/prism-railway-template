import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityRequirementsFromSkillMarkdown,
  credentialRequirementsFromSkillMarkdown,
} from "./prism-skills.js";

test("skill frontmatter capability requirements support YAML lists", () => {
  assert.deepEqual(capabilityRequirementsFromSkillMarkdown(`---
name: discord-send
description: Send a message.
metadata:
  gateway-capabilities:
    - comms.message.send
    - analytics.query
---

Instructions.
`), ["comms.message.send", "analytics.query"]);
});

test("skill frontmatter accepts credential assignment metadata", () => {
  assert.deepEqual(credentialRequirementsFromSkillMarkdown(`---
name: analytics-report
metadata:
  gateway-credentials: [plausible-production]
---
`), ["plausible-production"]);
});

test("invalid capability keys are ignored", () => {
  assert.deepEqual(capabilityRequirementsFromSkillMarkdown(`---
name: unsafe
metadata:
  gateway-capabilities: [valid.read, "../../secret", "bad key"]
---
`), ["valid.read"]);
});
