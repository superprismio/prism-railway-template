import { randomUUID } from "node:crypto";
import net from "node:net";
import type Database from "better-sqlite3";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "./crypto.js";
import type {
  GatewayCapability,
  GatewayConnection,
  HttpJsonReadDriverConfig,
} from "./types.js";

export class GatewayStoreError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

type ConnectionRow = {
  id: string;
  provider: string;
  label: string;
  auth_type: string;
  status: GatewayConnection["status"];
  last_tested_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type CapabilityRow = {
  key: string;
  driver_key: string;
  connection_id: string | null;
  provider: string;
  description: string;
  mode: GatewayCapability["mode"];
  risk_level: GatewayCapability["riskLevel"];
  requires_approval: number;
  enabled: number;
  input_schema_json: string | null;
  output_schema_json: string | null;
  driver_config_json: string;
  created_at: string;
  updated_at: string;
};

type SecretRow = EncryptedSecret & {
  secret_name: string;
};

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  return JSON.parse(value) as Record<string, unknown>;
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

function isPrivateIpLiteral(hostname: string) {
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) return isPrivateIpv4(hostname);
  if (ipVersion !== 6) return false;
  const normalized = hostname.toLowerCase();
  if (
    normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
  ) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function validatePublicHttpsBaseUrl(value: unknown) {
  if (typeof value !== "string") throw new GatewayStoreError("CAPABILITY_BASE_URL_REQUIRED", 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatewayStoreError("CAPABILITY_BASE_URL_INVALID", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new GatewayStoreError("CAPABILITY_BASE_URL_MUST_BE_PUBLIC_HTTPS_ORIGIN", 400);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || isPrivateIpLiteral(hostname)
  ) {
    throw new GatewayStoreError("CAPABILITY_BASE_URL_PRIVATE_HOST_FORBIDDEN", 400);
  }
  return url.origin;
}

export function normalizeHttpJsonReadConfig(value: unknown): HttpJsonReadDriverConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayStoreError("CAPABILITY_DRIVER_CONFIG_REQUIRED", 400);
  }
  const input = value as Record<string, unknown>;
  const baseUrl = validatePublicHttpsBaseUrl(input.baseUrl);
  const pathTemplate = typeof input.pathTemplate === "string" ? input.pathTemplate.trim() : "";
  if (!pathTemplate.startsWith("/") || pathTemplate.includes("://") || pathTemplate.includes("..")) {
    throw new GatewayStoreError("CAPABILITY_PATH_TEMPLATE_INVALID", 400);
  }
  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : 10_000;
  const maxResponseBytes = typeof input.maxResponseBytes === "number" ? input.maxResponseBytes : 1_000_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new GatewayStoreError("CAPABILITY_TIMEOUT_INVALID", 400);
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1_024 || maxResponseBytes > 5_000_000) {
    throw new GatewayStoreError("CAPABILITY_RESPONSE_LIMIT_INVALID", 400);
  }
  return { baseUrl, pathTemplate, timeoutMs, maxResponseBytes };
}

function connectionFromRow(
  db: Database.Database,
  row: ConnectionRow,
): GatewayConnection {
  const secretNames = (db.prepare(
    "SELECT secret_name AS name FROM encrypted_secrets WHERE connection_id = ? ORDER BY secret_name",
  ).all(row.id) as Array<{ name: string }>).map((entry) => entry.name);
  const capabilityKeys = (db.prepare(
    "SELECT key FROM capabilities WHERE connection_id = ? ORDER BY key",
  ).all(row.id) as Array<{ key: string }>).map((entry) => entry.key);
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    authType: row.auth_type,
    status: row.status,
    capabilityKeys,
    secretNames,
    lastTestedAt: row.last_tested_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function capabilityFromRow(row: CapabilityRow): GatewayCapability {
  return {
    key: row.key,
    driverKey: row.driver_key,
    connectionId: row.connection_id,
    provider: row.provider,
    description: row.description,
    mode: row.mode,
    riskLevel: row.risk_level,
    requiresApproval: row.requires_approval === 1,
    enabled: row.enabled === 1,
    inputSchema: parseJson(row.input_schema_json),
    outputSchema: parseJson(row.output_schema_json),
    driverConfig: parseJson(row.driver_config_json) || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GatewayStore {
  constructor(
    private readonly db: Database.Database,
    private readonly encryption: { key: Buffer; keyVersion: string },
  ) {}

  seedBuiltInDrivers() {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO connector_drivers (key, mode, description, built_in, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        mode = excluded.mode,
        description = excluded.description,
        updated_at = excluded.updated_at
    `).run(
      "http-json.read",
      "read",
      "Constrained JSON GET requests to an admin-configured public HTTPS origin.",
      now,
      now,
    );
  }

  stats() {
    const count = (table: string) => (
      this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
    ).count;
    return {
      drivers: count("connector_drivers"),
      capabilities: count("capabilities"),
      connections: count("integration_connections"),
      auditEvents: count("audit_events"),
    };
  }

  listDrivers() {
    return this.db.prepare(`
      SELECT key, mode, description, built_in AS builtIn, created_at AS createdAt, updated_at AS updatedAt
      FROM connector_drivers ORDER BY key
    `).all();
  }

  listConnections() {
    const rows = this.db.prepare(
      "SELECT * FROM integration_connections ORDER BY label, id",
    ).all() as ConnectionRow[];
    return rows.map((row) => connectionFromRow(this.db, row));
  }

  getConnection(id: string) {
    const row = this.db.prepare(
      "SELECT * FROM integration_connections WHERE id = ?",
    ).get(id) as ConnectionRow | undefined;
    return row ? connectionFromRow(this.db, row) : null;
  }

  createConnection(input: {
    provider: string;
    label: string;
    authType: string;
    credentials: Record<string, string>;
  }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const entries = Object.entries(input.credentials);
    if (entries.length === 0) throw new GatewayStoreError("CONNECTION_CREDENTIALS_REQUIRED", 400);

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO integration_connections
          (id, provider, label, auth_type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'untested', ?, ?)
      `).run(id, input.provider, input.label, input.authType, now, now);
      this.writeCredentials(id, entries, now);
    })();

    return this.getConnection(id)!;
  }

  replaceConnectionCredentials(id: string, credentials: Record<string, string>) {
    const entries = Object.entries(credentials);
    if (!this.getConnection(id)) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    if (entries.length === 0) throw new GatewayStoreError("CONNECTION_CREDENTIALS_REQUIRED", 400);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM encrypted_secrets WHERE connection_id = ?").run(id);
      this.writeCredentials(id, entries, now);
      this.db.prepare(`
        UPDATE integration_connections
        SET status = 'untested', last_tested_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, id);
    })();
    return this.getConnection(id)!;
  }

  revokeConnection(id: string) {
    if (!this.getConnection(id)) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM encrypted_secrets WHERE connection_id = ?").run(id);
      this.db.prepare(`
        UPDATE integration_connections SET status = 'revoked', updated_at = ? WHERE id = ?
      `).run(now, id);
    })();
    return this.getConnection(id)!;
  }

  getConnectionCredentials(id: string) {
    if (!this.getConnection(id)) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    const rows = this.db.prepare(`
      SELECT
        secret_name,
        encrypted_value AS encryptedValue,
        nonce,
        auth_tag AS authTag,
        key_version AS keyVersion,
        associated_data_json AS associatedDataJson
      FROM encrypted_secrets WHERE connection_id = ? ORDER BY secret_name
    `).all(id) as SecretRow[];
    return Object.fromEntries(rows.map((row) => [
      row.secret_name,
      decryptSecret(row, { connectionId: id, secretName: row.secret_name, key: this.encryption.key }),
    ]));
  }

  private writeCredentials(id: string, entries: Array<[string, string]>, now: string) {
    const insert = this.db.prepare(`
      INSERT INTO encrypted_secrets
        (id, connection_id, secret_name, encrypted_value, nonce, auth_tag, key_version,
         associated_data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [secretName, value] of entries) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName) || !value) {
        throw new GatewayStoreError("CONNECTION_CREDENTIAL_INVALID", 400);
      }
      const encrypted = encryptSecret(value, {
        connectionId: id,
        secretName,
        keyVersion: this.encryption.keyVersion,
        key: this.encryption.key,
      });
      insert.run(
        randomUUID(), id, secretName, encrypted.encryptedValue, encrypted.nonce,
        encrypted.authTag, encrypted.keyVersion, encrypted.associatedDataJson, now, now,
      );
    }
  }

  listCapabilities() {
    const rows = this.db.prepare("SELECT * FROM capabilities ORDER BY key").all() as CapabilityRow[];
    return rows.map(capabilityFromRow);
  }

  createCapability(input: {
    key: string;
    driverKey: string;
    connectionId: string;
    provider: string;
    description: string;
    driverConfig: unknown;
    inputSchema?: Record<string, unknown> | null;
    outputSchema?: Record<string, unknown> | null;
  }) {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(input.key)) {
      throw new GatewayStoreError("CAPABILITY_KEY_INVALID", 400);
    }
    if (input.driverKey !== "http-json.read") {
      throw new GatewayStoreError("CAPABILITY_DRIVER_UNSUPPORTED", 400);
    }
    const connection = this.getConnection(input.connectionId);
    if (!connection || connection.status === "revoked") {
      throw new GatewayStoreError("CAPABILITY_CONNECTION_UNAVAILABLE", 400);
    }
    if (connection.provider !== input.provider) {
      throw new GatewayStoreError("CAPABILITY_CONNECTION_PROVIDER_MISMATCH", 400);
    }
    const driverConfig = normalizeHttpJsonReadConfig(input.driverConfig);
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO capabilities
          (key, driver_key, connection_id, provider, mode, description, driver_config_json,
           input_schema_json, output_schema_json, risk_level, requires_approval,
           default_unit_price, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'read', ?, ?, ?, ?, 'low', 0, 0, 1, ?, ?)
      `).run(
        input.key,
        input.driverKey,
        input.connectionId,
        input.provider,
        input.description,
        JSON.stringify(driverConfig),
        input.inputSchema ? JSON.stringify(input.inputSchema) : null,
        input.outputSchema ? JSON.stringify(input.outputSchema) : null,
        now,
        now,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new GatewayStoreError("CAPABILITY_ALREADY_EXISTS", 409);
      }
      throw error;
    }
    return this.listCapabilities().find((capability) => capability.key === input.key)!;
  }
}
