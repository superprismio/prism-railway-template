import assert from "node:assert/strict";
import test from "node:test";
import {
  credentialLeaseToolsetKeys,
  mergeRuntimeToolsets,
} from "./codex-runtime.js";

test("skill requirements preserve assigned toolset protocols", () => {
  assert.deepEqual(
    mergeRuntimeToolsets(
      [{ key: "plausible.analytics", protocol: "http" }],
      ["plausible.analytics", "wallet.admin"],
    ),
    [
      { key: "plausible.analytics", protocol: "http" },
      { key: "wallet.admin" },
    ],
  );
});

test("runtime leases only environment-backed toolsets", () => {
  assert.deepEqual(
    credentialLeaseToolsetKeys([
      { key: "plausible.analytics", protocol: "http" },
      { key: "nextcrm.admin", protocol: "mcp" },
      { key: "wallet.admin", protocol: "adapter" },
      { key: "legacy.skill-credential" },
    ]),
    ["wallet.admin", "legacy.skill-credential"],
  );
});
