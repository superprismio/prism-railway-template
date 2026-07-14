import assert from "node:assert/strict";
import test from "node:test";
import { interactiveGatewayToolsets } from "./gateway-toolset-assignment";

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
