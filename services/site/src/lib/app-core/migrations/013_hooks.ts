import type { Migration } from './index';

export const hooksMigration: Migration = {
  name: '013_hooks',
  sql: `
    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      workflow_key TEXT NOT NULL,
      auth_mode TEXT NOT NULL DEFAULT 'service-token',
      request_template_json TEXT NOT NULL DEFAULT '{}',
      auto_run_json TEXT NOT NULL DEFAULT '{}',
      system_default INTEGER NOT NULL DEFAULT 0 CHECK (system_default IN (0, 1)),
      last_triggered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_key) REFERENCES workflows(key)
    );
  `,
};
