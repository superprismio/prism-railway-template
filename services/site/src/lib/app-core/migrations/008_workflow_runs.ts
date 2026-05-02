export const workflowRunsMigration = {
  name: '008_workflow_runs',
  sql: `
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE REFERENCES change_requests(id) ON DELETE CASCADE,
      workflow_key TEXT NOT NULL,
      current_step_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_status
      ON workflow_runs(workflow_key, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS workflow_events (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
      step_key TEXT,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'system',
      actor_id TEXT,
      note TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_events_run_created
      ON workflow_events(workflow_run_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_workflow_events_request_created
      ON workflow_events(request_id, created_at DESC);

  `,
};
