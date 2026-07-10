export type GatewayMigration = {
  name: string;
  sql: string;
};

export const gatewayMigrations: GatewayMigration[] = [
  {
    name: "001_initial_gateway",
    sql: `
      CREATE TABLE connector_drivers (
        key TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        description TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE integration_connections (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        status TEXT NOT NULL,
        last_tested_at TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE encrypted_secrets (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        secret_name TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        nonce TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        key_version TEXT NOT NULL,
        associated_data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connection_id, secret_name),
        FOREIGN KEY(connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE
      );

      CREATE TABLE capabilities (
        key TEXT PRIMARY KEY,
        driver_key TEXT NOT NULL,
        connection_id TEXT,
        provider TEXT NOT NULL,
        mode TEXT NOT NULL,
        description TEXT NOT NULL,
        driver_config_json TEXT NOT NULL,
        input_schema_json TEXT,
        output_schema_json TEXT,
        risk_level TEXT NOT NULL,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        default_unit_price REAL NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(driver_key) REFERENCES connector_drivers(key),
        FOREIGN KEY(connection_id) REFERENCES integration_connections(id) ON DELETE SET NULL
      );

      CREATE TABLE capability_grants (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        capability_key TEXT NOT NULL,
        allowed INTEGER NOT NULL DEFAULT 1,
        policy_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(subject_type, subject_id, capability_key),
        FOREIGN KEY(capability_key) REFERENCES capabilities(key) ON DELETE CASCADE
      );

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        capability_key TEXT NOT NULL,
        authenticated_caller_id TEXT NOT NULL,
        delegated_actor_id TEXT,
        request_id TEXT,
        workflow_run_id TEXT,
        workflow_step_key TEXT,
        status TEXT NOT NULL,
        policy_decision TEXT NOT NULL,
        budget_decision TEXT,
        latency_ms INTEGER,
        error_code TEXT,
        input_summary_json TEXT,
        output_summary_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX audit_events_trace_id_idx ON audit_events(trace_id);
      CREATE INDEX audit_events_capability_created_idx ON audit_events(capability_key, created_at);

      CREATE TABLE usage_ledger (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        capability_key TEXT NOT NULL,
        authenticated_caller_id TEXT NOT NULL,
        delegated_actor_id TEXT,
        request_id TEXT,
        units REAL NOT NULL,
        unit_price REAL NOT NULL,
        estimated_cost REAL NOT NULL,
        actual_cost REAL,
        settlement_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    name: "002_toolset_profiles",
    sql: `
      CREATE TABLE toolset_profiles (
        key TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        protocol TEXT NOT NULL,
        discovery_url TEXT NOT NULL,
        description TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_discovered_at TEXT,
        discovery_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE
      );

      CREATE INDEX toolset_profiles_connection_idx ON toolset_profiles(connection_id);
    `,
  },
  {
    name: "003_toolset_credential_binding",
    sql: `
      ALTER TABLE toolset_profiles ADD COLUMN auth_config_json TEXT NOT NULL DEFAULT '{"type":"none"}';
    `,
  },
  {
    name: "004_toolset_env_bindings",
    sql: `
      ALTER TABLE toolset_profiles ADD COLUMN env_bindings_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
];
