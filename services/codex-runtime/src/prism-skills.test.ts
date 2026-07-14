import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRequirementsFromSkillMarkdown, toolsetRequirementsFromSkillMarkdown } from "./prism-skills.js";

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

test("skill frontmatter toolset requirements support YAML lists", () => {
  assert.deepEqual(toolsetRequirementsFromSkillMarkdown(`---
name: portal-ops
metadata:
  gateway-toolsets:
    - portal.admin
---
`), ["portal.admin"]);
});

test("skill frontmatter accepts credential assignment metadata", () => {
  assert.deepEqual(toolsetRequirementsFromSkillMarkdown(`---
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
