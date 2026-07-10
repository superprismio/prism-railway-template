import assert from "node:assert/strict";
import test from "node:test";
import { readSkillCapabilityRequirements } from "./hosted-skills";

test("hosted skill summaries expose declared Gateway requirements", () => {
  assert.deepEqual(readSkillCapabilityRequirements(`---
name: discord-send
description: Send a message.
metadata:
  gateway-capabilities:
    - comms.message.send
    - analytics.query
---
`), ["comms.message.send", "analytics.query"]);
});

test("hosted skill requirements reject malformed capability keys", () => {
  assert.deepEqual(readSkillCapabilityRequirements(`---
name: unsafe
metadata:
  gateway-capabilities: [valid.read, "../../secret", "bad key"]
---
`), ["valid.read"]);
});
