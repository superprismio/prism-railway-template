import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const taskRunnerToken = "task-runner-token-for-gateway-tests";

test("gateway migration removes legacy toolset profile storage", () => {
  const root = mkdtempSync(path.join(tmpdir(), "prism-gateway-migration-test-"));
  const db = openGatewayDatabase(path.join(root, "gateway.sqlite"));
  try {
    runGatewayMigrations(db);
    db.exec("CREATE TABLE toolset_profiles (key TEXT PRIMARY KEY)");
    db.prepare("DELETE FROM schema_migrations WHERE name = ?")
      .run("007_remove_legacy_toolset_profiles");

    const result = runGatewayMigrations(db);

    assert.deepEqual(result.executed, ["007_remove_legacy_toolset_profiles"]);
    const legacyTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'toolset_profiles'",
    ).get();
    assert.equal(legacyTable, undefined);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

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

test("gateway stores, leases, audits, rotates, and revokes trusted runtime credentials", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "prism-gateway-test-"));
  const config: GatewayConfig = {
    port: 0,
    dbPath: path.join(root, "gateway.sqlite"),
    masterKey: randomBytes(32),
    masterKeyVersion: "test-v1",
    previousMasterKeys: [],
    callers: [
      { id: "site", kind: "service", runtimeKey: null, token: siteToken },
      { id: "codex-runtime", kind: "runtime", runtimeKey: "codex-test", token: codexToken },
      { id: "task-runner", kind: "service", runtimeKey: null, token: taskRunnerToken },
    ],
  };
  const db = openGatewayDatabase(config.dbPath);
  const migrations = runGatewayMigrations(db);
  const store = new GatewayStore(db, { key: config.masterKey, keyVersion: config.masterKeyVersion });
  store.seedBuiltInDrivers();
  const invoker = new GatewayInvoker(store, async () => ({
    result: { ok: true },
    status: 200,
    responseBytes: 12,
  }));
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

    const plaintext = "sendgrid-secret-value";
    const created = await jsonRequest(baseUrl, "/connections", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-token": siteToken },
      body: JSON.stringify({
        key: "sendgrid",
        provider: "sendgrid",
        label: "SendGrid",
        authType: "api-key",
        credentials: { apiKey: plaintext },
        configuration: { SENDGRID_BASE_URL: "https://api.sendgrid.com" },
        envBindings: { SENDGRID_API_KEY: "apiKey" },
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.text.includes(plaintext), false);
    const connection = created.body.connection as Record<string, unknown>;
    const connectionId = String(connection.id);
    assert.equal(connection.key, "sendgrid");
    assert.deepEqual(connection.secretNames, ["apiKey"]);

    const runtimeCannotList = await jsonRequest(baseUrl, "/credential-bundles", {
      headers: { "x-gateway-token": codexToken },
    });
    assert.equal(runtimeCannotList.response.status, 403);

    const siteCannotLease = await jsonRequest(baseUrl, "/credential-bundles/lease", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-token": siteToken },
      body: JSON.stringify({ credentials: ["sendgrid"] }),
    });
    assert.equal(siteCannotLease.response.status, 403);

    const runtimeLease = await jsonRequest(baseUrl, "/credential-bundles/lease", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-token": codexToken },
      body: JSON.stringify({
        credentials: ["sendgrid"],
        context: { delegatedActorId: "admin-console", runtimeJobId: "runtime-job-1" },
      }),
    });
    assert.equal(runtimeLease.response.status, 200);
    assert.deepEqual(runtimeLease.body.env, {
      SENDGRID_BASE_URL: "https://api.sendgrid.com",
      SENDGRID_API_KEY: plaintext,
    });
    assert.deepEqual(runtimeLease.body.leasedCredentials, ["sendgrid"]);

    const taskLease = await jsonRequest(baseUrl, "/credential-bundles/lease", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-token": taskRunnerToken },
      body: JSON.stringify({
        credentials: ["sendgrid"],
        context: { delegatedActorId: "task:notification", runtimeJobId: "task-run-1" },
      }),
    });
    assert.equal(taskLease.response.status, 200);

    const events = store.listAuditEvents(10);
    assert.equal(events.some((event) =>
      event.capabilityKey === "credential:sendgrid"
      && event.policyDecision === "trusted_runtime_credential_lease"
      && event.authenticatedCallerId === "codex-runtime"
    ), true);
    assert.equal(events.some((event) => event.authenticatedCallerId === "task-runner"), true);
    assert.equal(JSON.stringify(events).includes(plaintext), false);

    const encryptedRow = db.prepare(
      "SELECT encrypted_value AS encryptedValue FROM encrypted_secrets WHERE connection_id = ?",
    ).get(connectionId) as { encryptedValue: string };
    assert.notEqual(encryptedRow.encryptedValue, plaintext);

    const replacement = "replacement-secret-value";
    const replaced = await jsonRequest(baseUrl, `/connections/${connectionId}/credentials`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-gateway-token": siteToken },
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

    const revokedLease = await jsonRequest(baseUrl, "/credential-bundles/lease", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-token": codexToken },
      body: JSON.stringify({ credentials: ["sendgrid"] }),
    });
    assert.equal(revokedLease.response.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("gateway backup and master-key rotation preserve encrypted credentials", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "prism-gateway-ops-test-"));
  const dbPath = path.join(root, "gateway.sqlite");
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const db = openGatewayDatabase(dbPath);
  const migrations = runGatewayMigrations(db);
  const oldStore = new GatewayStore(db, { key: oldKey, keyVersion: "ops-v1" });
  const connection = oldStore.createConnection({
    provider: "test-provider",
    label: "Operations test",
    authType: "api-key",
    credentials: { apiKey: "credential-survives-rotation" },
  });
  const stableUpdatedAt = "2026-01-01T00:00:00.000Z";
  db.prepare("UPDATE integration_connections SET updated_at = ? WHERE id = ?")
    .run(stableUpdatedAt, connection.id);
  oldStore.upsertStoredCredentials({ OPS_API_KEY: "stored-credential-survives-rotation" });
  const boundConnection = oldStore.createConnection({
    provider: "stored-provider",
    label: "Stored operations test",
    authType: "api-key",
    credentials: {},
  });
  oldStore.bindStoredCredentials(boundConnection.id, { apiKey: "OPS_API_KEY" });
  const mismatchedStore = new GatewayStore(db, { key: newKey, keyVersion: "ops-v1" });
  assert.equal(mismatchedStore.getConnection(connection.id)?.updatedAt, stableUpdatedAt);
  assert.equal(mismatchedStore.encryptionStatus().unreadableSecretCount, 2);
  const config: GatewayConfig = {
    port: 0,
    dbPath,
    masterKey: newKey,
    masterKeyVersion: "ops-v2",
    previousMasterKeys: [{ key: oldKey, keyVersion: "ops-v1" }],
    callers: [{ id: "site", kind: "service", runtimeKey: null, token: siteToken }],
  };
  const store = new GatewayStore(db, {
    key: newKey,
    keyVersion: "ops-v2",
    previousKeys: config.previousMasterKeys,
  });
  const app = createGatewayApp({
    config,
    db,
    store,
    invoker: new GatewayInvoker(store),
    migrationCount: migrations.totalKnown,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    assert.equal(store.encryptionStatus().rotationRequired, true);
    assert.equal(store.getConnectionCredentials(connection.id).apiKey, "credential-survives-rotation");
    assert.equal(
      store.getConnectionCredentials(boundConnection.id).apiKey,
      "stored-credential-survives-rotation",
    );

    const unauthorized = await jsonRequest(baseUrl, "/ops/rotate-master-key", { method: "POST" });
    assert.equal(unauthorized.response.status, 401);

    const rotated = await jsonRequest(baseUrl, "/ops/rotate-master-key", {
      method: "POST",
      headers: { "x-gateway-token": siteToken },
    });
    assert.equal(rotated.response.status, 200);
    assert.equal((rotated.body.rotation as Record<string, unknown>).rotated, 2);
    assert.equal(store.encryptionStatus().rotationRequired, false);

    const repeated = await jsonRequest(baseUrl, "/ops/rotate-master-key", {
      method: "POST",
      headers: { "x-gateway-token": siteToken },
    });
    assert.equal((repeated.body.rotation as Record<string, unknown>).rotated, 0);

    const backup = await jsonRequest(baseUrl, "/ops/backup", {
      method: "POST",
      headers: { "x-gateway-token": siteToken },
    });
    assert.equal(backup.response.status, 200);
    const details = backup.body.backup as Record<string, unknown>;
    const backupPath = path.join(root, "backups", String(details.database));
    const manifestPath = path.join(root, "backups", String(details.manifest));
    assert.equal(existsSync(backupPath), true);
    assert.equal(existsSync(manifestPath), true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    assert.equal(manifest.currentKeyVersion, "ops-v2");
    assert.match(String(manifest.sha256), /^[a-f0-9]{64}$/);

    const restoredDb = openGatewayDatabase(backupPath);
    try {
      const restoredStore = new GatewayStore(restoredDb, { key: newKey, keyVersion: "ops-v2" });
      assert.equal(restoredDb.pragma("quick_check", { simple: true }), "ok");
      assert.equal(
        restoredStore.getConnectionCredentials(connection.id).apiKey,
        "credential-survives-rotation",
      );
      assert.equal(
        restoredStore.getConnectionCredentials(boundConnection.id).apiKey,
        "stored-credential-survives-rotation",
      );
    } finally {
      restoredDb.close();
    }
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
