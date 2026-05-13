export const targetAppsAndChangeRequestsMigration = {
  name: '003_target_apps_and_change_requests',
  sql: `
    CREATE TABLE IF NOT EXISTS target_apps (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      repo_url TEXT,
      repo_provider TEXT,
      default_branch TEXT NOT NULL DEFAULT 'main',
      framework TEXT,
      deploy_backend TEXT NOT NULL,
      deploy_config_json TEXT NOT NULL DEFAULT '{}',
      agent_enabled INTEGER NOT NULL DEFAULT 1 CHECK (agent_enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_target_apps_slug_unique
      ON target_apps(slug);

    CREATE INDEX IF NOT EXISTS idx_target_apps_agent_enabled
      ON target_apps(agent_enabled, slug);

    CREATE TABLE IF NOT EXISTS target_environments (
      id TEXT PRIMARY KEY,
      target_app_id TEXT NOT NULL REFERENCES target_apps(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      branch TEXT,
      base_url TEXT,
      deploy_backend TEXT NOT NULL,
      deploy_config_json TEXT NOT NULL DEFAULT '{}',
      agent_writable INTEGER NOT NULL DEFAULT 0 CHECK (agent_writable IN (0, 1)),
      auto_deploy_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_deploy_enabled IN (0, 1)),
      human_review_required INTEGER NOT NULL DEFAULT 1 CHECK (human_review_required IN (0, 1)),
      is_default_for_agent INTEGER NOT NULL DEFAULT 0 CHECK (is_default_for_agent IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_target_environments_app_slug_unique
      ON target_environments(target_app_id, slug);

    CREATE INDEX IF NOT EXISTS idx_target_environments_lookup
      ON target_environments(target_app_id, kind, agent_writable);

    CREATE TABLE IF NOT EXISTS change_requests (
      id TEXT PRIMARY KEY,
      request_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      request_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      priority TEXT NOT NULL DEFAULT 'normal',
      source TEXT NOT NULL DEFAULT 'manual',
      requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_app_id TEXT NOT NULL REFERENCES target_apps(id) ON DELETE CASCADE,
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_change_requests_request_number_unique
      ON change_requests(request_number);

    CREATE INDEX IF NOT EXISTS idx_change_requests_listing
      ON change_requests(status, priority, created_at);

    CREATE INDEX IF NOT EXISTS idx_change_requests_target_app
      ON change_requests(target_app_id, created_at);
  `,
};
