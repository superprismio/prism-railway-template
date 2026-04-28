export const agentSessionsMigration = {
  name: '005_agent_sessions',
  sql: `
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      title TEXT,
      discord_guild_id TEXT,
      discord_channel_id TEXT,
      discord_thread_id TEXT,
      linked_change_request_id TEXT REFERENCES change_requests(id) ON DELETE SET NULL,
      linked_target_environment_id TEXT REFERENCES target_environments(id) ON DELETE SET NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_discord_thread_unique
      ON agent_sessions(discord_thread_id)
      WHERE discord_thread_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_discord_channel
      ON agent_sessions(discord_channel_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_last_message
      ON agent_sessions(last_message_at DESC, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      source TEXT NOT NULL,
      source_message_id TEXT,
      content TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created
      ON agent_messages(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_agent_messages_source_message
      ON agent_messages(source, source_message_id);
  `,
};
