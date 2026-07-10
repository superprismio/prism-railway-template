import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayApp } from "./app.js";
import { openGatewayDatabase, runGatewayMigrations } from "./db.js";
import { createPinnedLookup, executeHttpJsonRead, GatewayDriverError } from "./http-json-read.js";
import { executeMcpToolCall } from "./mcp-tool-call.js";
import { GatewayInvoker } from "./invoke.js";
import { GatewayStore, normalizeMcpToolCallConfig } from "./store.js";
import type { GatewayConfig } from "./types.js";

const siteToken = "site-token-for-gateway-tests";
const codexToken = "codex-token-for-gateway-tests";

async function jsonRequest(
  baseUrl: string,
  pathname: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  return {
    response,
    text,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
  };
}

test("gateway stores credentials safely and enforces caller identity", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "prism-gateway-test-"));
  const config: GatewayConfig = {
    port: 0,
    dbPath: path.join(root, "gateway.sqlite"),
    masterKey: randomBytes(32),
    masterKeyVersion: "test-v1",
    callers: [
      { id: "site", kind: "service", runtimeKey: null, token: siteToken },
      { id: "codex-runtime", kind: "runtime", runtimeKey: "codex-test", token: codexToken },
    ],
  };
  const db = openGatewayDatabase(config.dbPath);
  const migrations = runGatewayMigrations(db);
  const store = new GatewayStore(db, { key: config.masterKey, keyVersion: config.masterKeyVersion });
  store.seedBuiltInDrivers();
  const invoker = new GatewayInvoker(store, async (driverConfig, credentials, input) => {
    assert.equal(driverConfig.baseUrl, "https://analytics.example.org");
    assert.equal(credentials.apiKey, "plausible-secret-value");
    assert.deepEqual(input, { period: "7d" });
    return { result: { visitors: 123 }, status: 200, responseBytes: 16 };
  });
  const app = createGatewayApp({ config, db, store, invoker, migrationCount: migrations.totalKnown });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await jsonRequest(baseUrl, "/health");
    assert.equal(health.response.status, 200);
    assert.equal(health.body.ok, true);

    const unauthorized = await jsonRequest(baseUrl, "/connections");
    assert.equal(unauthorized.response.status, 401);

    const forbidden = await jsonRequest(baseUrl, "/connections", {
      headers: { "x-gateway-token": codexToken },
    });
    assert.equal(forbidden.response.status, 403);

    const plaintext = "plausible-secret-value";
    const created = await jsonRequest(baseUrl, "/connections", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": siteToken,
      },
      body: JSON.stringify({
        provider: "analytics",
        label: "Primary analytics",
        authType: "api-key",
        credentials: { apiKey: plaintext },
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.text.includes(plaintext), false);
    const connection = created.body.connection as Record<string, unknown>;
    const connectionId = String(connection.id);
    assert.deepEqual(connection.secretNames, ["apiKey"]);
    assert.equal(store.getConnectionCredentials(connectionId).apiKey, plaintext);

    const encryptedRow = db.prepare(
      "SELECT encrypted_value AS encryptedValue FROM encrypted_secrets WHERE connection_id = ?",
    ).get(connectionId) as { encryptedValue: string };
    assert.notEqual(encryptedRow.encryptedValue, plaintext);

    const privateCapability = await jsonRequest(baseUrl, "/capabilities", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": siteToken,
      },
      body: JSON.stringify({
        key: "analytics.query",
        driverKey: "http-json.read",
        connectionId,
        provider: "analytics",
        description: "Read analytics",
        driverConfig: { baseUrl: "http://127.0.0.1:3000", pathTemplate: "/api/stats" },
      }),
    });
    assert.equal(privateCapability.response.status, 400);
    assert.equal(privateCapability.body.error, "CAPABILITY_BASE_URL_MUST_BE_PUBLIC_HTTPS_ORIGIN");

    const privateIpv6Capability = await jsonRequest(baseUrl, "/capabilities", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": siteToken,
      },
      body: JSON.stringify({
        key: "analytics.private",
        driverKey: "http-json.read",
        connectionId,
        provider: "analytics",
        description: "Forbidden private analytics",
        driverConfig: { baseUrl: "https://[::1]", pathTemplate: "/api/stats" },
      }),
    });
    assert.equal(privateIpv6Capability.response.status, 400);
    assert.equal(privateIpv6Capability.body.error, "CAPABILITY_BASE_URL_PRIVATE_HOST_FORBIDDEN");

    const capability = await jsonRequest(baseUrl, "/capabilities", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": siteToken,
      },
      body: JSON.stringify({
        key: "analytics.query",
        driverKey: "http-json.read",
        connectionId,
        provider: "analytics",
        description: "Read analytics",
        driverConfig: {
          baseUrl: "https://analytics.example.org",
          pathTemplate: "/api/stats",
          timeoutMs: 5000,
          maxResponseBytes: 250000,
          allowedQueryParams: ["period"],
          auth: { type: "bearer", secretName: "apiKey" },
        },
      }),
    });
    assert.equal(capability.response.status, 201);

    const pendingCapability = await jsonRequest(baseUrl, "/capabilities", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": siteToken,
      },
      body: JSON.stringify({
        key: "analytics.pending",
        driverKey: "http-json.read",
        connectionId,
        provider: "analytics",
        description: "Pending analytics setup",
        enabled: false,
        driverConfig: {
          baseUrl: "https://analytics.example.org",
          pathTemplate: "/api/stats",
          allowedQueryParams: ["period"],
          auth: { type: "bearer", secretName: "apiKey" },
        },
      }),
    });
    assert.equal(pendingCapability.response.status, 201);
    assert.equal((pendingCapability.body.capability as Record<string, unknown>).enabled, false);

    const tested = await jsonRequest(baseUrl, "/capabilities/analytics.query/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": siteToken,
      },
      body: JSON.stringify({ input: { period: "7d" } }),
    });
    assert.equal(tested.response.status, 200);
    assert.deepEqual(tested.body.result, { visitors: 123 });

    const denied = await jsonRequest(baseUrl, "/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": codexToken,
      },
      body: JSON.stringify({ capability: "analytics.query", input: { period: "7d" } }),
    });
    assert.equal(denied.response.status, 403);
    assert.equal((denied.body.error as Record<string, unknown>).code, "CAPABILITY_POLICY_DENIED");

    const grant = await jsonRequest(baseUrl, "/grants/codex-analytics-read", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": siteToken,
      },
      body: JSON.stringify({
        subjectType: "runtime",
        subjectId: "codex-test",
        capabilityKey: "analytics.query",
        allowed: true,
      }),
    });
    assert.equal(grant.response.status, 200);

    const invoked = await jsonRequest(baseUrl, "/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": codexToken,
      },
      body: JSON.stringify({
        capability: "analytics.query",
        input: { period: "7d" },
        context: { requestId: "349" },
      }),
    });
    assert.equal(invoked.response.status, 200);
    assert.deepEqual(invoked.body.result, { visitors: 123 });
    assert.equal(invoked.text.includes(plaintext), false);

    const updatedCapability = await jsonRequest(baseUrl, "/capabilities/analytics.query", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": siteToken,
      },
      body: JSON.stringify({
        description: "Query analytics with a required site id.",
        inputSchema: {
          type: "object",
          required: ["site_id", "metrics", "date_range"],
        },
        driverConfig: {
          baseUrl: "https://analytics.example.org",
          pathTemplate: "/api/v2/query",
          method: "POST",
          allowedQueryParams: [],
          allowedJsonBodyParams: ["site_id", "metrics", "date_range"],
          staticJsonBody: {},
          auth: { type: "bearer", secretName: "apiKey" },
        },
      }),
    });
    assert.equal(updatedCapability.response.status, 200);
    assert.equal(
      ((updatedCapability.body.capability as Record<string, unknown>).driverConfig as Record<string, unknown>).method,
      "POST",
    );
    assert.deepEqual(
      ((updatedCapability.body.capability as Record<string, unknown>).inputSchema as Record<string, unknown>).required,
      ["site_id", "metrics", "date_range"],
    );

    const audit = await jsonRequest(baseUrl, "/audit-events", {
      headers: { "x-gateway-token": siteToken },
    });
    assert.equal(audit.response.status, 200);
    const events = audit.body.events as Array<Record<string, unknown>>;
    assert.equal(events.length, 3);
    assert.equal(JSON.stringify(events).includes(plaintext), false);

    const replacement = "replacement-secret-value";
    const replaced = await jsonRequest(baseUrl, `/connections/${connectionId}/credentials`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": siteToken,
      },
      body: JSON.stringify({ credentials: { apiKey: replacement } }),
    });
    assert.equal(replaced.response.status, 200);
    assert.equal(replaced.text.includes(replacement), false);
    assert.equal(store.getConnectionCredentials(connectionId).apiKey, replacement);

    const revoked = await jsonRequest(baseUrl, `/connections/${connectionId}`, {
      method: "DELETE",
      headers: { "x-gateway-token": siteToken },
    });
    assert.equal(revoked.response.status, 200);
    assert.equal((revoked.body.connection as Record<string, unknown>).status, "revoked");
    assert.deepEqual(store.getConnectionCredentials(connectionId), {});
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("http-json.read pins public DNS and never allows runtime headers or redirects", async () => {
  const config = {
    baseUrl: "https://analytics.example.org",
    pathTemplate: "/api/stats",
    method: "GET" as const,
    timeoutMs: 5000,
    maxResponseBytes: 250000,
    allowedQueryParams: ["period"],
    allowedJsonBodyParams: [],
    staticJsonBody: {},
    auth: { type: "api-key" as const, secretName: "apiKey", headerName: "X-Api-Key" },
  };
  const result = await executeHttpJsonRead(config, { apiKey: "secret" }, { period: "7d" }, {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, headers, _driverConfig, address) => {
      assert.equal(url.href, "https://analytics.example.org/api/stats?period=7d");
      assert.equal(headers["X-Api-Key"], "secret");
      assert.equal(address.address, "93.184.216.34");
      return { result: { ok: true }, status: 200, responseBytes: 11 };
    },
  });
  assert.deepEqual(result.result, { ok: true });

  await assert.rejects(
    executeHttpJsonRead(config, { apiKey: "secret" }, { headers: "forbidden" }, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    }),
    (error: unknown) => error instanceof GatewayDriverError && error.code === "CAPABILITY_INPUT_KEY_NOT_ALLOWED",
  );
  await assert.rejects(
    executeHttpJsonRead(config, { apiKey: "secret" }, { period: "7d" }, {
      resolve: async () => [{ address: "169.254.169.254", family: 4 }],
    }),
    (error: unknown) => error instanceof GatewayDriverError && error.code === "CAPABILITY_DNS_PRIVATE_ADDRESS_FORBIDDEN",
  );
});

test("http-json.read supports fixed-target allowlisted JSON POST reads", async () => {
  const config = {
    baseUrl: "https://plausible.io",
    pathTemplate: "/api/v2/query",
    method: "POST" as const,
    timeoutMs: 5000,
    maxResponseBytes: 250000,
    allowedQueryParams: [],
    allowedJsonBodyParams: ["metrics", "date_range", "dimensions"],
    staticJsonBody: { site_id: "prism.example.org" },
    auth: { type: "bearer" as const, secretName: "apiKey" },
  };
  const result = await executeHttpJsonRead(
    config,
    { apiKey: "secret" },
    { metrics: ["visitors", "pageviews"], date_range: "7d" },
    {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (url, headers, driverConfig, address, body) => {
        assert.equal(url.href, "https://plausible.io/api/v2/query");
        assert.equal(driverConfig.method, "POST");
        assert.equal(headers.authorization, "Bearer secret");
        assert.equal(headers["content-type"], "application/json");
        assert.equal(address.address, "93.184.216.34");
        assert.deepEqual(JSON.parse(body || "{}"), {
          site_id: "prism.example.org",
          metrics: ["visitors", "pageviews"],
          date_range: "7d",
        });
        return { result: { results: [] }, status: 200, responseBytes: 14 };
      },
    },
  );
  assert.deepEqual(result.result, { results: [] });

  await assert.rejects(
    executeHttpJsonRead(config, { apiKey: "secret" }, { site_id: "other.example.org" }),
    (error: unknown) => error instanceof GatewayDriverError && error.code === "CAPABILITY_INPUT_KEY_NOT_ALLOWED",
  );
  await assert.rejects(
    executeHttpJsonRead(config, { apiKey: "secret" }, { headers: { authorization: "other" } }),
    (error: unknown) => error instanceof GatewayDriverError && error.code === "CAPABILITY_INPUT_KEY_NOT_ALLOWED",
  );
});

test("mcp-tool.call maps fixed operations to allowlisted tools and unwraps SSE results", async () => {
  const config = normalizeMcpToolCallConfig({
    baseUrl: "https://crm.example.org",
    pathTemplate: "/api/mcp/mcp",
    timeoutMs: 5000,
    maxResponseBytes: 250000,
    operations: {
      list: { toolName: "crm_list_contacts", allowedArguments: ["limit", "offset"] },
      search: { toolName: "crm_search_contacts", allowedArguments: ["query", "limit", "offset"] },
    },
    auth: { type: "bearer", secretName: "apiToken" },
  });
  const result = await executeMcpToolCall(
    config,
    { apiToken: "secret" },
    { operation: "search", query: "Acme", limit: 5 },
    {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (url, headers, _driverConfig, address, body) => {
        assert.equal(url.href, "https://crm.example.org/api/mcp/mcp");
        assert.equal(headers.authorization, "Bearer secret");
        assert.equal(address.address, "93.184.216.34");
        assert.deepEqual(JSON.parse(body), {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "crm_search_contacts",
            arguments: { query: "Acme", limit: 5 },
          },
        });
        return {
          status: 200,
          responseBytes: 120,
          contentType: "text/event-stream",
          body: 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"data\\":[],\\"total\\":0,\\"offset\\":0}"}]}}\n\n',
        };
      },
    },
  );
  assert.deepEqual(result.result, { data: [], total: 0, offset: 0 });
  assert.equal(result.operation, "search");
  assert.equal(result.toolName, "crm_search_contacts");

  await assert.rejects(
    executeMcpToolCall(config, { apiToken: "secret" }, { operation: "delete", id: "record-1" }),
    (error: unknown) => error instanceof GatewayDriverError && error.code === "CAPABILITY_INPUT_OPERATION_NOT_ALLOWED",
  );
  await assert.rejects(
    executeMcpToolCall(config, { apiToken: "secret" }, { operation: "list", headers: { authorization: "other" } }),
    (error: unknown) => error instanceof GatewayDriverError && error.code === "CAPABILITY_INPUT_KEY_NOT_ALLOWED",
  );
  await assert.rejects(
    executeMcpToolCall(config, { apiToken: "secret" }, { operation: "list" }, {
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    }),
    (error: unknown) => error instanceof GatewayDriverError && error.code === "CAPABILITY_DNS_PRIVATE_ADDRESS_FORBIDDEN",
  );
});

test("pinned lookup supports Node single and multi-address callbacks", () => {
  const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });
  lookup("example.org", { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
  });
  lookup("example.org", { all: false }, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
});
