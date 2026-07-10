import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeGatewayPresetOrigin,
  plausibleGatewayCapability,
} from "./gateway-presets";

test("Plausible preset creates a disabled fixed-target capability", () => {
  const capability = plausibleGatewayCapability({
    connectionId: "connection-1",
    origin: "https://plausible.example.org",
  });
  assert.equal(capability.enabled, false);
  assert.equal(capability.connectionId, "connection-1");
  assert.equal(capability.driverConfig.baseUrl, "https://plausible.example.org");
  assert.equal(capability.driverConfig.pathTemplate, "/api/v2/query");
  assert.deepEqual(capability.inputSchema.required, ["site_id", "metrics", "date_range"]);
});

test("preset origins require a bare HTTPS origin", () => {
  assert.equal(normalizeGatewayPresetOrigin("https://plausible.example.org/"), "https://plausible.example.org");
  assert.equal(normalizeGatewayPresetOrigin("http://plausible.example.org"), null);
  assert.equal(normalizeGatewayPresetOrigin("https://user:secret@example.org"), null);
  assert.equal(normalizeGatewayPresetOrigin("https://example.org/api"), null);
});
