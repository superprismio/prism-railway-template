export const requestArtifactsMigration = {
  name: '010_request_artifacts',
  sql: `
    CREATE TABLE IF NOT EXISTS request_artifacts (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
      workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
      execution_id TEXT REFERENCES change_request_executions(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      mime_type TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_request_artifacts_request_created
      ON request_artifacts(request_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_request_artifacts_kind_created
      ON request_artifacts(kind, created_at DESC);
  `,
};
