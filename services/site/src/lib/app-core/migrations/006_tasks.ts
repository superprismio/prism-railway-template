export const tasksMigration = {
  name: '006_tasks',
  sql: `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      trigger_type TEXT NOT NULL DEFAULT 'schedule',
      schedule_cron TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      task_type TEXT NOT NULL DEFAULT 'builtin',
      input_config_json TEXT NOT NULL DEFAULT '{}',
      instruction_config_json TEXT NOT NULL DEFAULT '{}',
      output_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      trigger_source TEXT NOT NULL DEFAULT 'manual',
      started_at TEXT,
      finished_at TEXT,
      result_summary TEXT,
      error_message TEXT,
      input_snapshot_json TEXT NOT NULL DEFAULT '{}',
      output_snapshot_json TEXT NOT NULL DEFAULT '{}',
      artifact_refs_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_runs_task
      ON task_runs(task_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_task_runs_status
      ON task_runs(status, created_at DESC);
  `,
};
