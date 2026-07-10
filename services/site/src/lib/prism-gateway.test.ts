import assert from "node:assert/strict";
import test from "node:test";
import {
  interactiveGatewayCapabilities,
  interactiveGatewayCapabilityKeys,
} from "./prism-gateway-policy";

const capabilities = [
  {
    key: "analytics.query",
    mode: "read",
    enabled: true,
    description: "Query analytics.",
    inputSchema: { type: "object", required: ["site_id"] },
  },
  { key: "portal.session.update", mode: "write", enabled: true },
  { key: "storage.delete", mode: "destructive", enabled: true },
  { key: "disabled.read", mode: "read", enabled: false },
];

test("readonly and run-approved interactive profiles expose reads only", () => {
  assert.deepEqual(interactiveGatewayCapabilityKeys(capabilities, "readonly"), ["analytics.query"]);
  assert.deepEqual(interactiveGatewayCapabilityKeys(capabilities, "run-approved"), ["analytics.query"]);
});

test("interactive profiles preserve runtime-visible descriptions and schemas", () => {
  assert.deepEqual(interactiveGatewayCapabilities(capabilities, "readonly"), [{
    key: "analytics.query",
    mode: "read",
    description: "Query analytics.",
    inputSchema: { type: "object", required: ["site_id"] },
  }]);
});

test("full admin profile exposes every enabled capability", () => {
  assert.deepEqual(interactiveGatewayCapabilityKeys(capabilities, "full"), [
    "analytics.query",
    "portal.session.update",
    "storage.delete",
  ]);
  assert.deepEqual(interactiveGatewayCapabilityKeys(capabilities, "off"), []);
});
