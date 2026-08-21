import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { agentProfilesMigration } from './migrations/040_agent_profiles';
import { agentProfileAvatarMigration } from './migrations/041_agent_profile_avatar';
import { agentProfileAccentColorMigration } from './migrations/042_agent_profile_accent_color';
import {
  adminAgentProfileId,
  assignAgentProfileToSession,
  getAgentProfile,
  getAgentProfileVersion,
  getAgentSessionProfileAssignment,
  listAgentProfiles,
  resolveAgentProfileBinding,
  resolveAgentProfileInteraction,
  upsertAgentProfile,
  upsertAgentProfileBinding,
} from './agent-profiles';

function testDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE roles (id INTEGER PRIMARY KEY, slug TEXT);
    CREATE TABLE user_roles (user_id TEXT, role_id INTEGER);
    CREATE TABLE runtime_profiles (key TEXT PRIMARY KEY);
    CREATE TABLE change_requests (id TEXT PRIMARY KEY, request_number INTEGER, title TEXT);
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL, title TEXT,
      linked_change_request_id TEXT, created_by_user_id TEXT, last_message_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT);
    CREATE TABLE agent_response_jobs (
      id TEXT PRIMARY KEY, session_id TEXT, status TEXT, input_json TEXT, response_json TEXT,
      trace_json TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY, kind TEXT, status TEXT, request_id TEXT, workflow_step_key TEXT,
      session_id TEXT, input_json TEXT NOT NULL DEFAULT '{}', created_at TEXT, started_at TEXT, finished_at TEXT
    );
    INSERT INTO users VALUES ('admin-user'), ('owner-user');
    INSERT INTO profiles VALUES ('admin-user', 'Ada Admin'), ('owner-user', 'Omar Owner');
    INSERT INTO roles VALUES (1, 'admin');
    INSERT INTO user_roles VALUES ('admin-user', 1);
  `);
  db.exec(agentProfilesMigration.sql);
  db.exec(agentProfileAvatarMigration.sql);
  db.exec(agentProfileAccentColorMigration.sql);
  return db;
}

test('seeds the protected Admin Agent with workspace stewardship', () => {
  const db = testDb();
  const profiles = listAgentProfiles({}, db);
  assert.equal(profiles[0]?.id, adminAgentProfileId);
  assert.equal(profiles[0]?.systemKey, 'admin-agent');
  assert.deepEqual(profiles[0]?.stewards.map((steward) => steward.displayName), ['Ada Admin']);
  assert.throws(() => upsertAgentProfile({ key: 'admin-agent', name: 'Replacement' }, db), /ADMIN_AGENT_PROFILE_PROTECTED/);
  const editedAdmin = upsertAgentProfile({ key: 'admin-agent', name: 'Admin Agent', avatarUrl: '/avatars/admin.png', allowSystemProfileUpdate: true }, db);
  assert.equal(editedAdmin.avatarUrl, '/avatars/admin.png');
  assert.equal(getAgentProfileVersion(adminAgentProfileId, 1, db)?.avatarUrl, null);
  db.close();
});

test('creates owned agents, prevents cycles, and assigns a surface to one primary agent', () => {
  const db = testDb();
  const owned = upsertAgentProfile({
    key: 'veydrift-agent', name: 'Veydrift Agent', status: 'active', ownerType: 'user',
    ownerUserId: 'owner-user', stewardUserIds: ['admin-user'], skills: ['veydrift', 'veydrift'], avatarUrl: 'https://example.com/agent.png', accentColor: '#FF4FD8',
  }, db);
  assert.equal(owned.owner.userId, 'owner-user');
  assert.deepEqual(owned.stewards.map((steward) => steward.userId).sort(), ['admin-user', 'owner-user']);
  assert.deepEqual(owned.skills, ['veydrift']);
  assert.equal(owned.avatarUrl, 'https://example.com/agent.png');
  assert.equal(owned.accentColor, '#FF4FD8');
  assert.throws(() => upsertAgentProfile({ key: owned.key, name: owned.name, accentColor: '#000000' }, db), /AGENT_PROFILE_ACCENT_COLOR_INVALID/);
  assert.throws(() => upsertAgentProfile({ key: owned.key, name: owned.name, avatarUrl: 'javascript:alert(1)' }, db), /AGENT_PROFILE_AVATAR_URL_INVALID/);
  const child = upsertAgentProfile({
    key: 'channel-agent', name: 'Channel Agent', status: 'active', ownerType: 'agent',
    ownerAgentProfileId: owned.id, stewardUserIds: ['owner-user'],
  }, db);
  assert.throws(() => upsertAgentProfile({
    key: owned.key, name: owned.name, ownerType: 'agent', ownerAgentProfileId: child.id,
  }, db), /AGENT_PROFILE_OWNERSHIP_CYCLE/);
  upsertAgentProfileBinding({ profileId: owned.id, surfaceType: 'buzz', surfaceKey: 'veydrift', label: 'Veydrift' }, db);
  upsertAgentProfileBinding({
    profileId: child.id,
    surfaceType: 'buzz',
    surfaceKey: 'veydrift',
    label: 'Veydrift handoff',
    configuration: {
      accessMode: 'full',
      rateLimit: { windowSeconds: 30, maxRequests: 8 },
      allowedWorkflows: ['publish'],
      overrides: { users: { 'readonly-user': { mode: 'readonly' } } },
    },
  }, db);
  assert.equal(resolveAgentProfileBinding('buzz', 'veydrift', db)?.id, child.id);
  assert.equal(getAgentProfile(owned.key, db)?.bindings.length, 0);
  const full = resolveAgentProfileInteraction({ surfaceType: 'buzz', surfaceKey: 'veydrift', userId: 'operator' }, db);
  assert.equal(full?.policy.accessMode, 'full');
  assert.equal(full?.policy.rateLimit.maxRequests, 8);
  assert.deepEqual(full?.policy.allowedWorkflows, ['publish']);
  const readonly = resolveAgentProfileInteraction({ surfaceType: 'buzz', surfaceKey: 'veydrift', userId: 'readonly-user' }, db);
  assert.equal(readonly?.policy.accessMode, 'readonly');
  assert.equal(readonly?.policy.capabilities.includes('workflows.author'), false);
  upsertAgentProfileBinding({
    profileId: child.id,
    surfaceType: 'discord',
    surfaceKey: 'public-channel',
    configuration: { accessMode: 'readonly', overrides: { users: { admin: { mode: 'full' } } } },
  }, db);
  assert.equal(
    resolveAgentProfileInteraction({ surfaceType: 'discord', surfaceKey: 'public-channel', userId: 'admin' }, db)?.policy.accessMode,
    'readonly',
  );
  db.close();
});

test('pins session and new job/run records to an immutable agent profile version', () => {
  const db = testDb();
  const profile = upsertAgentProfile({
    key: 'recording-agent', name: 'Recording Agent', status: 'active', ownerType: 'user', ownerUserId: 'owner-user',
  }, db);
  db.prepare(`INSERT INTO agent_sessions (id, source, status, created_at, updated_at) VALUES ('session-1', 'admin-console', 'active', '2026-01-01', '2026-01-01')`).run();
  assignAgentProfileToSession({ sessionId: 'session-1', profileId: profile.id, conversationScope: 'individual' }, db);
  assert.deepEqual(getAgentSessionProfileAssignment('session-1', db), {
    profileId: profile.id, profileVersion: 1, conversationScope: 'individual',
  });
  db.prepare(`INSERT INTO agent_response_jobs (id, session_id, status, input_json, response_json, trace_json, created_at, updated_at) VALUES ('job-1', 'session-1', 'queued', '{"execution_mode":"orchestrator"}', '{}', '[]', '2026-01-01', '2026-01-01')`).run();
  db.prepare(`INSERT INTO agent_runs (id, kind, status, session_id, input_json, created_at) VALUES ('run-1', 'console', 'queued', 'session-1', '{"execution_mode":"orchestrator"}', '2026-01-01')`).run();
  assert.deepEqual(db.prepare('SELECT agent_profile_id, agent_profile_version, execution_mode FROM agent_response_jobs WHERE id = ?').get('job-1'), {
    agent_profile_id: profile.id, agent_profile_version: 1, execution_mode: 'orchestrator',
  });
  assert.deepEqual(db.prepare('SELECT agent_profile_id, agent_profile_version, execution_mode FROM agent_runs WHERE id = ?').get('run-1'), {
    agent_profile_id: profile.id, agent_profile_version: 1, execution_mode: 'orchestrator',
  });
  db.close();
});
