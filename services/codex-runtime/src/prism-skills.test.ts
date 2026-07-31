import assert from "node:assert/strict";
import test from "node:test";
import { credentialRequirementsFromSkillMarkdown, requestedSkillNames } from "./prism-skills.js";

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

test("Buzz channel administration requests load the protected admin skill", () => {
  assert.ok(requestedSkillNames("Create a private Buzz channel for delivery").includes("prism-buzz-channel-admin"));
  assert.ok(requestedSkillNames("Add this member to the channel", { transport: "buzz" }).includes("prism-buzz-channel-admin"));
  assert.equal(requestedSkillNames("Summarize this channel", { transport: "buzz" }).includes("prism-buzz-channel-admin"), false);
});
