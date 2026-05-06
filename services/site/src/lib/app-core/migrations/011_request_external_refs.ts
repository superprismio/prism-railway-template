export const requestExternalRefsMigration = {
  name: '011_request_external_refs',
  sql: `
    CREATE TABLE IF NOT EXISTS request_external_refs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      external_id TEXT,
      title TEXT,
      url TEXT NOT NULL,
      state TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_request_external_refs_request_created
      ON request_external_refs(request_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_request_external_refs_provider_kind
      ON request_external_refs(provider, kind, external_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_request_external_refs_request_url_unique
      ON request_external_refs(request_id, url);
  `,
};
