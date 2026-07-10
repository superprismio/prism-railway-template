import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRequirementsFromSkillMarkdown } from "./prism-skills.js";

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

test("invalid capability keys are ignored", () => {
  assert.deepEqual(capabilityRequirementsFromSkillMarkdown(`---
name: unsafe
metadata:
  gateway-capabilities: [valid.read, "../../secret", "bad key"]
---
`), ["valid.read"]);
});
