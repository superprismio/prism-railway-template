import assert from "node:assert/strict";
import test from "node:test";
import {
  gatewayToolsetsForKeys,
  interactiveGatewayToolsets,
  trustedRuntimeAdapterToolsets,
} from "./gateway-toolset-assignment";

test("interactive assignments do not duplicate credentials behind connected services", () => {
  assert.deepEqual(
    interactiveGatewayToolsets(
      [
        { key: "plausible.analytics", protocol: "http" },
        { key: "wallet.admin", protocol: "adapter" },
      ],
      [
        { key: "plausible", protocol: "adapter", toolsetKeys: ["plausible.analytics"] },
        { key: "wallet", protocol: "adapter", toolsetKeys: ["wallet.admin"] },
        { key: "standalone", protocol: "adapter", toolsetKeys: [] },
      ],
    ),
    [
      { key: "plausible.analytics", protocol: "http" },
      { key: "wallet.admin", protocol: "adapter" },
      { key: "standalone", protocol: "adapter" },
    ],
  );
});

test("workflow assignments preserve descriptors for initial and continued steps", () => {
  const enabled = [
    { key: "portal.admin", protocol: "http" as const, description: "Portal CMS" },
    { key: "crm.admin", protocol: "mcp" as const },
  ];

  assert.deepEqual(gatewayToolsetsForKeys(["portal.admin"], enabled), [enabled[0]]);
  assert.deepEqual(gatewayToolsetsForKeys(["portal.admin", "missing.profile"], enabled), [
    enabled[0],
    { key: "missing.profile" },
  ]);
});

test("trusted workflow runtimes inherit only environment-backed adapter profiles", () => {
  assert.deepEqual(
    trustedRuntimeAdapterToolsets([
      { key: "x.admin", protocol: "adapter" },
      { key: "portal.admin", protocol: "http" },
      { key: "crm.admin", protocol: "mcp" },
      { key: "legacy.unknown" },
    ]),
    [{ key: "x.admin", protocol: "adapter" }],
  );
});
