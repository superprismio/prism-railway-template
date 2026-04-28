export const changeRequestExecutionsMigration = {
  name: '004_change_request_executions',
  sql: `
    CREATE TABLE IF NOT EXISTS change_request_executions (
      id TEXT PRIMARY KEY,
      change_request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
      target_environment_id TEXT REFERENCES target_environments(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      actor_type TEXT NOT NULL DEFAULT 'codex',
      branch_name TEXT,
      commit_sha TEXT,
      deploy_url TEXT,
      adapter_kind TEXT,
      adapter_status TEXT,
      summary TEXT,
      error_message TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_change_request_executions_request
      ON change_request_executions(change_request_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_change_request_executions_environment
      ON change_request_executions(target_environment_id, created_at DESC);
  `,
};
