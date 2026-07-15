import assert from "node:assert/strict";
import test from "node:test";
import { credentialRequirementsFromSkillMarkdown } from "./prism-skills.js";

test("skill frontmatter accepts credential assignment metadata", () => {
  assert.deepEqual(credentialRequirementsFromSkillMarkdown(`---
name: analytics-report
metadata:
  gateway-credentials: [plausible-production]
---
`), ["plausible-production"]);
});

test("invalid credential keys are ignored", () => {
  assert.deepEqual(credentialRequirementsFromSkillMarkdown(`---
name: unsafe
metadata:
  gateway-credentials: [sendgrid, "../../secret", "bad key"]
---
`), ["sendgrid"]);
});
