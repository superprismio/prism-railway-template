import assert from "node:assert/strict";
import test from "node:test";
import { mergeSkillCapabilityRequirements } from "./capability-requirements.js";

test("skill capability requirements are added without losing job descriptors", () => {
  assert.deepEqual(mergeSkillCapabilityRequirements(
    [{ key: "analytics.query", description: "Query analytics" }],
    [
      { requiredCapabilities: ["comms.message.send", "analytics.query"] },
      { requiredCapabilities: ["storage.artifact.write"] },
    ],
  ), [
    { key: "analytics.query", description: "Query analytics" },
    { key: "comms.message.send" },
    { key: "storage.artifact.write" },
  ]);
});
