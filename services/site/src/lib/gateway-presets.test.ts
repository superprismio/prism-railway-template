import assert from "node:assert/strict";
import test from "node:test";
import {
  nextcrmContactReadCapability,
  nextcrmGatewayToolset,
  normalizeGatewayPresetOrigin,
  plausibleGatewayCapability,
  plausibleGatewayToolset,
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

test("Plausible preset creates a disabled broad HTTP toolset", () => {
  const toolset = plausibleGatewayToolset({
    connectionId: "connection-1",
    origin: "https://plausible.example.org",
  });
  assert.equal(toolset.key, "plausible.analytics");
  assert.equal(toolset.protocol, "http");
  assert.equal(toolset.discoveryUrl, "https://plausible.example.org");
  assert.equal(toolset.enabled, false);
  assert.deepEqual(toolset.auth, { type: "bearer", secretName: "apiKey" });
});

test("NextCRM preset exposes only fixed contact read operations", () => {
  const capability = nextcrmContactReadCapability({
    connectionId: "connection-2",
    origin: "https://crm.example.org",
  });
  assert.equal(capability.enabled, false);
  assert.equal(capability.driverKey, "mcp-tool.call");
  assert.equal(capability.driverConfig.pathTemplate, "/api/mcp/mcp");
  assert.deepEqual(Object.keys(capability.driverConfig.operations), ["list", "get", "search"]);
  assert.equal(capability.driverConfig.operations.get.toolName, "crm_get_contact");
});

test("NextCRM preset creates a disabled broad MCP toolset", () => {
  const toolset = nextcrmGatewayToolset({
    connectionId: "connection-2",
    origin: "https://crm.example.org",
  });
  assert.equal(toolset.key, "nextcrm.admin");
  assert.equal(toolset.protocol, "mcp");
  assert.equal(toolset.discoveryUrl, "https://crm.example.org/api/mcp/mcp");
  assert.equal(toolset.enabled, false);
  assert.deepEqual(toolset.auth, { type: "bearer", secretName: "apiToken" });
});

test("preset origins require a bare HTTPS origin", () => {
  assert.equal(normalizeGatewayPresetOrigin("https://plausible.example.org/"), "https://plausible.example.org");
  assert.equal(normalizeGatewayPresetOrigin("http://plausible.example.org"), null);
  assert.equal(normalizeGatewayPresetOrigin("https://user:secret@example.org"), null);
  assert.equal(normalizeGatewayPresetOrigin("https://example.org/api"), null);
});
