import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import { createGatewayApp } from "./app.js";
import { openGatewayDatabase, runGatewayMigrations } from "./db.js";
import { GatewayStore } from "./store.js";
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
  const app = createGatewayApp({ config, db, store, migrationCount: migrations.totalKnown });
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
        },
      }),
    });
    assert.equal(capability.response.status, 201);

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
