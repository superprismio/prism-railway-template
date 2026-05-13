export const dropChangeRequestStatusMigration = {
  name: '016_drop_change_request_status',
  sql: `
    PRAGMA foreign_keys = OFF;

    CREATE TABLE change_requests_new (
      id TEXT PRIMARY KEY,
      request_number INTEGER NOT NULL,
      workflow_key TEXT NOT NULL DEFAULT 'change-request-default',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      request_type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      source TEXT NOT NULL DEFAULT 'manual',
      requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_app_id TEXT REFERENCES target_apps(id) ON DELETE SET NULL,
      target_environment_id TEXT REFERENCES target_environments(id) ON DELETE SET NULL,
      triage_summary TEXT,
      acceptance_criteria_json TEXT,
      constraints_json TEXT,
      attachments_json TEXT,
      agent_recommendation TEXT,
      review_notes TEXT,
      resolution_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      triaged_at TEXT,
      approved_for_work_at TEXT,
      completed_at TEXT,
      closed_at TEXT
    );

    INSERT INTO change_requests_new (
      id, request_number, workflow_key, title, description, request_type, priority, source,
      requested_by_user_id, target_app_id, target_environment_id, triage_summary,
      acceptance_criteria_json, constraints_json, attachments_json, agent_recommendation,
      review_notes, resolution_summary, created_at, updated_at,
      triaged_at, approved_for_work_at, completed_at, closed_at
    )
    SELECT
      id, request_number, workflow_key, title, description, request_type, priority, source,
      requested_by_user_id, target_app_id, target_environment_id, triage_summary,
      acceptance_criteria_json, constraints_json, attachments_json, agent_recommendation,
      review_notes, resolution_summary, created_at, updated_at,
      triaged_at, approved_for_work_at, completed_at, closed_at
    FROM change_requests;

    DROP TABLE change_requests;
    ALTER TABLE change_requests_new RENAME TO change_requests;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_change_requests_request_number_unique
      ON change_requests(request_number);

    CREATE INDEX IF NOT EXISTS idx_change_requests_listing
      ON change_requests(priority, created_at);

    CREATE INDEX IF NOT EXISTS idx_change_requests_target_app
      ON change_requests(target_app_id, created_at);

    PRAGMA foreign_keys = ON;
  `,
};
