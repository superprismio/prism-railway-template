export const userInvitesMigration = {
  name: '012_user_invites',
  sql: `
    CREATE TABLE IF NOT EXISTS user_invites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invites_token_hash_unique
      ON user_invites(token_hash);

    CREATE INDEX IF NOT EXISTS idx_user_invites_user_id_created
      ON user_invites(user_id, created_at DESC);
  `,
};
