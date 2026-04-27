export const initialMigration = {
  name: '001_initial_schema',
  sql: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      password_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT,
      is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
      is_seeded INTEGER NOT NULL DEFAULT 0 CHECK (is_seeded IN (0, 1))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users(email)
      WHERE email IS NOT NULL;

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_token_hash_unique
      ON user_sessions(token_hash);

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
      ON user_sessions(user_id);

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      handle TEXT NOT NULL,
      display_name TEXT NOT NULL,
      bio TEXT,
      avatar_url TEXT,
      wallet_address TEXT,
      email TEXT,
      links_json TEXT NOT NULL DEFAULT '[]',
      skills_json TEXT NOT NULL DEFAULT '[]',
      cohorts_json TEXT NOT NULL DEFAULT '[]',
      location TEXT,
      contact_json TEXT NOT NULL DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'public',
      visibility_json TEXT NOT NULL DEFAULT '{}',
      seed_source TEXT,
      seed_external_id TEXT,
      seeded_at TEXT,
      claimed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_unique
      ON profiles(handle);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_id_unique
      ON profiles(user_id)
      WHERE user_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_profiles_email
      ON profiles(email);

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_slug_unique
      ON roles(slug);

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS skills_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0, 1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_catalog_slug_unique
      ON skills_catalog(slug);

    CREATE INDEX IF NOT EXISTS idx_skills_catalog_is_active
      ON skills_catalog(is_active);

    CREATE TABLE IF NOT EXISTS community_roles_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT,
      skill_type TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0, 1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_community_roles_catalog_slug_unique
      ON community_roles_catalog(slug);

    CREATE INDEX IF NOT EXISTS idx_community_roles_catalog_is_active
      ON community_roles_catalog(is_active);

    CREATE TABLE IF NOT EXISTS user_skills (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill_id INTEGER NOT NULL REFERENCES skills_catalog(id) ON DELETE CASCADE,
      proficiency INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS user_community_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      community_role_id INTEGER NOT NULL REFERENCES community_roles_catalog(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, community_role_id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_slug_unique
      ON tags(slug);

    CREATE TABLE IF NOT EXISTS taggings (
      id TEXT PRIMARY KEY,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_taggings_target_unique
      ON taggings(tag_id, target_type, target_id);

    CREATE INDEX IF NOT EXISTS idx_taggings_target_lookup
      ON taggings(target_type, target_id);

    CREATE TABLE IF NOT EXISTS badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_badges_slug_unique
      ON badges(slug);

    CREATE TABLE IF NOT EXISTS user_badges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      awarded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      awarded_at TEXT NOT NULL,
      reason TEXT,
      UNIQUE (user_id, badge_id)
    );

    CREATE TABLE IF NOT EXISTS points_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      reason TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_points_ledger_user_id
      ON points_ledger(user_id);

    CREATE INDEX IF NOT EXISTS idx_points_ledger_created_at
      ON points_ledger(created_at);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT,
      url TEXT,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug_unique
      ON projects(slug);

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS external_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      username TEXT,
      avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'verified',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_external_identities_provider_external_user_id_unique
      ON external_identities(provider, external_user_id);

    CREATE INDEX IF NOT EXISTS idx_external_identities_user_id
      ON external_identities(user_id);

    CREATE TABLE IF NOT EXISTS external_identity_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      code TEXT,
      nonce TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_external_identity_links_provider_status
      ON external_identity_links(provider, status);

    CREATE TABLE IF NOT EXISTS home_modules (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      display_order INTEGER NOT NULL DEFAULT 0,
      visibility_role TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_home_modules_enabled_order
      ON home_modules(enabled, display_order);

    CREATE TABLE IF NOT EXISTS admin_change_requests (
      id TEXT PRIMARY KEY,
      request_type TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'normal',
      payload_json TEXT NOT NULL DEFAULT '{}',
      requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      assigned_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_admin_change_requests_listing
      ON admin_change_requests(state, created_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
      ON audit_log(created_at);

    CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id
      ON audit_log(actor_user_id);

    CREATE INDEX IF NOT EXISTS idx_audit_log_target_lookup
      ON audit_log(target_type, target_id);
  `,
};