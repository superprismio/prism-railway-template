import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { runGatewayMigrations } from "./db.js";
import { GatewayStore } from "./store.js";
import { generatedEnvironmentName, isProtectedLeasedEnvironmentName } from "./environment-names.js";

test("restart preserves explicit mappings and repairs only redundant invalid generated aliases", () => {
  const db = new Database(":memory:");
  const encryption = { key: randomBytes(32), keyVersion: "test" };
  try {
    runGatewayMigrations(db);
    let store = new GatewayStore(db, encryption);
    const credential = store.createConnection({ key: "railway-app-builder-playground", provider: "railway",
      label: "Builder", authType: "api-key", credentials: { projectToken: "test-token" },
      envBindings: { APP_BUILDER_RAILWAY_TOKEN: "projectToken" }, configuration: { APP_BUILDER_RAILWAY_PROJECT_ID: "test-project" } });
    const before = store.getCredential(credential.key)!;
    store = new GatewayStore(db, encryption);
    assert.deepEqual(store.getCredential(credential.key), before);
    db.prepare("UPDATE integration_connections SET env_bindings_json = ? WHERE id = ?").run(JSON.stringify({
      APP_BUILDER_RAILWAY_TOKEN: "projectToken", RAILWAY_APP_BUILDER_PLAYGROUND_PROJECT_TOKEN: "projectToken",
    }), credential.id);
    store = new GatewayStore(db, encryption);
    assert.deepEqual(store.getCredential(credential.key)!.envBindings, { APP_BUILDER_RAILWAY_TOKEN: "projectToken" });
    assert.deepEqual(store.getConnectionCredentials(credential.id), { projectToken: "test-token" });
    const repaired = store.getCredential(credential.key);
    store = new GatewayStore(db, encryption);
    assert.deepEqual(store.getCredential(credential.key), repaired);
    store.updateCredentialBundle(credential.id, { envBindings: {} });
    store = new GatewayStore(db, encryption);
    assert.deepEqual(store.getCredential(credential.key)!.envBindings, {});
  } finally { db.close(); }
});

test("automatic aliases for reserved prefixes are lease-compatible", () => {
  const db = new Database(":memory:");
  try {
    runGatewayMigrations(db);
    const encryption = { key: randomBytes(32), keyVersion: "test" };
    let store = new GatewayStore(db, encryption);
    for (const prefix of ["RAILWAY", "PRISM", "CODEX", "NODE", "GATEWAY", "SENDGRID"]) {
      const c = store.createConnection({ key: `${prefix.toLowerCase()}-test`, provider: "custom",
        label: prefix, authType: "api-key", credentials: { apiKey: "test-token" } });
      const expected = generatedEnvironmentName(`${prefix}_TEST`, "API_KEY");
      assert.equal(isProtectedLeasedEnvironmentName(expected), false);
      assert.deepEqual(c.envBindings, { [expected]: "apiKey" });
      store = new GatewayStore(db, encryption);
      assert.deepEqual(store.getCredential(c.key)!.envBindings, c.envBindings);
    }
  } finally { db.close(); }
});
