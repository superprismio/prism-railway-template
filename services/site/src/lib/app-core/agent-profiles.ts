import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import { getDb } from './db';

export const adminAgentProfileId = 'agent-profile-admin';
export const adminAgentProfileKey = 'admin-agent';
export const agentExecutionModes = ['worker', 'orchestrator', 'verifier', 'reviewer', 'judge', 'repair'] as const;

export type AgentExecutionMode = (typeof agentExecutionModes)[number];
export type AgentProfileOwnerType = 'workspace' | 'user' | 'agent';
export type AgentProfileStatus = 'draft' | 'active' | 'disabled' | 'archived';
export type AgentConversationScope = 'individual' | 'channel' | 'thread' | 'automated';

export type AgentProfileOwner = {
  type: AgentProfileOwnerType;
  userId: string | null;
  agentProfileId: string | null;
};

export type AgentProfileSteward = {
  userId: string;
  displayName: string | null;
  role: 'owner' | 'steward';
};

export type AgentProfileBinding = {
  id: string;
  profileId: string;
  surfaceType: 'buzz' | 'discord' | 'telegram' | 'external' | 'user';
  surfaceKey: string;
  label: string | null;
  enabled: boolean;
  configuration: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentProfileRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: AgentProfileStatus;
  systemKey: string | null;
  owner: AgentProfileOwner;
  stewards: AgentProfileSteward[];
  persona: Record<string, unknown>;
  runtimeProfileKey: string | null;
  skills: string[];
  memoryScope: Record<string, unknown>;
  authority: Record<string, unknown>;
  contextPolicy: Record<string, unknown>;
  version: number;
  createdByUserId: string | null;
  bindings: AgentProfileBinding[];
  createdAt: string;
  updatedAt: string;
};

export type UpsertAgentProfileInput = {
  key: string;
  name: string;
  description?: string | null;
  status?: AgentProfileStatus;
  ownerType?: AgentProfileOwnerType;
  ownerUserId?: string | null;
  ownerAgentProfileId?: string | null;
  stewardUserIds?: string[];
  persona?: Record<string, unknown>;
  runtimeProfileKey?: string | null;
  skills?: string[];
  memoryScope?: Record<string, unknown>;
  authority?: Record<string, unknown>;
  contextPolicy?: Record<string, unknown>;
  createdByUserId?: string | null;
};

export type AgentProfileSessionSummary = {
  id: string;
  source: string;
  status: string;
  title: string | null;
  conversationScope: AgentConversationScope;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  linkedChangeRequestId: string | null;
  linkedRequestNumber: number | null;
  linkedRequestTitle: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentProfileActivityItem = {
  id: string;
  kind: 'session' | 'run';
  occurredAt: string;
  title: string;
  description: string;
  status: string;
  sessionId: string | null;
  requestId: string | null;
  requestNumber: number | null;
  requestTitle: string | null;
  workflowStepKey: string | null;
  executionMode: string | null;
  actorDisplayName: string | null;
};

export type AgentProfileSessionDetail = AgentProfileSessionSummary & {
  profileId: string;
  profileVersion: number | null;
  messages: Array<{
    id: string;
    role: string;
    source: string;
    sourceMessageId: string | null;
    content: string;
    authorId: string | null;
    authorName: string | null;
    createdAt: string;
  }>;
  runs: Array<{
    id: string;
    kind: string;
    status: string;
    requestId: string | null;
    requestNumber: number | null;
    workflowStepKey: string | null;
    executionMode: string | null;
    errorMessage: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
};

type AgentProfileRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: AgentProfileStatus;
  system_key: string | null;
  owner_type: AgentProfileOwnerType;
  owner_user_id: string | null;
  owner_agent_profile_id: string | null;
  persona_json: string;
  runtime_profile_key: string | null;
  skills_json: string;
  memory_scope_json: string;
  authority_json: string;
  context_policy_json: string;
  version: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function key(value: unknown) {
  const normalized = text(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized || normalized.length < 2) throw new Error('AGENT_PROFILE_KEY_INVALID');
  return normalized;
}

function jsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function jsonStrings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function bindingRows(profileId: string, db: Database.Database): AgentProfileBinding[] {
  return (db.prepare(`
    SELECT id, profile_id, surface_type, surface_key, label, enabled,
           configuration_json, created_by_user_id, created_at, updated_at
    FROM agent_profile_bindings WHERE profile_id = ?
    ORDER BY enabled DESC, surface_type, COALESCE(label, surface_key), surface_key
  `).all(profileId) as Array<{
    id: string; profile_id: string; surface_type: AgentProfileBinding['surfaceType']; surface_key: string;
    label: string | null; enabled: number; configuration_json: string; created_by_user_id: string | null;
    created_at: string; updated_at: string;
  }>).map((row) => ({
    id: row.id, profileId: row.profile_id, surfaceType: row.surface_type, surfaceKey: row.surface_key,
    label: row.label, enabled: row.enabled === 1, configuration: jsonRecord(row.configuration_json),
    createdByUserId: row.created_by_user_id, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

function stewardRows(profileId: string, db: Database.Database): AgentProfileSteward[] {
  return (db.prepare(`
    SELECT aps.user_id, aps.role, p.display_name
    FROM agent_profile_stewards aps
    LEFT JOIN profiles p ON p.user_id = aps.user_id
    WHERE aps.profile_id = ? ORDER BY aps.role, COALESCE(p.display_name, aps.user_id)
  `).all(profileId) as Array<{ user_id: string; role: 'owner' | 'steward'; display_name: string | null }>).map((row) => ({
    userId: row.user_id, displayName: row.display_name, role: row.role,
  }));
}

function mapRow(row: AgentProfileRow, db: Database.Database): AgentProfileRecord {
  return {
    id: row.id, key: row.key, name: row.name, description: row.description, status: row.status,
    systemKey: row.system_key,
    owner: { type: row.owner_type, userId: row.owner_user_id, agentProfileId: row.owner_agent_profile_id },
    stewards: stewardRows(row.id, db), persona: jsonRecord(row.persona_json), runtimeProfileKey: row.runtime_profile_key,
    skills: jsonStrings(row.skills_json), memoryScope: jsonRecord(row.memory_scope_json),
    authority: jsonRecord(row.authority_json), contextPolicy: jsonRecord(row.context_policy_json),
    version: row.version, createdByUserId: row.created_by_user_id, bindings: bindingRows(row.id, db),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function profileRowByKey(profileKey: string, db: Database.Database) {
  return db.prepare('SELECT * FROM agent_profiles WHERE key = ?').get(profileKey) as AgentProfileRow | undefined;
}

function profileRowById(profileId: string, db: Database.Database) {
  return db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(profileId) as AgentProfileRow | undefined;
}

function snapshot(record: AgentProfileRecord) {
  return {
    key: record.key, name: record.name, description: record.description, status: record.status,
    systemKey: record.systemKey, owner: record.owner,
    stewards: record.stewards.map(({ userId, role }) => ({ userId, role })),
    persona: record.persona, runtimeProfileKey: record.runtimeProfileKey, skills: record.skills,
    memoryScope: record.memoryScope, authority: record.authority, contextPolicy: record.contextPolicy,
    version: record.version,
  };
}

function assertOwner(input: { ownerType: AgentProfileOwnerType; ownerUserId: string | null; ownerAgentProfileId: string | null; profileId?: string }, db: Database.Database) {
  if (input.ownerType === 'workspace') return;
  if (input.ownerType === 'user') {
    if (!input.ownerUserId || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(input.ownerUserId)) throw new Error('AGENT_PROFILE_OWNER_USER_NOT_FOUND');
    return;
  }
  if (!input.ownerAgentProfileId || !profileRowById(input.ownerAgentProfileId, db)) throw new Error('AGENT_PROFILE_OWNER_AGENT_NOT_FOUND');
  if (input.ownerAgentProfileId === input.profileId) throw new Error('AGENT_PROFILE_OWNERSHIP_CYCLE');
  const seen = new Set([input.profileId].filter(Boolean));
  let cursor: string | null = input.ownerAgentProfileId;
  while (cursor) {
    if (seen.has(cursor)) throw new Error('AGENT_PROFILE_OWNERSHIP_CYCLE');
    seen.add(cursor);
    cursor = profileRowById(cursor, db)?.owner_agent_profile_id ?? null;
  }
}

export function ensureAdminAgentStewards(db: Database.Database = getDb()) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO agent_profile_stewards (profile_id, user_id, role, created_at)
    SELECT ?, ur.user_id, 'steward', ? FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id WHERE r.slug = 'admin'
  `).run(adminAgentProfileId, now);
}

export function listAgentProfiles(input: { includeArchived?: boolean } = {}, db: Database.Database = getDb()) {
  ensureAdminAgentStewards(db);
  const rows = db.prepare(`SELECT * FROM agent_profiles ${input.includeArchived ? '' : "WHERE status <> 'archived'"} ORDER BY CASE WHEN system_key = 'admin-agent' THEN 0 ELSE 1 END, name, key`).all() as AgentProfileRow[];
  return rows.map((row) => mapRow(row, db));
}

export function getAgentProfile(profileKey: string, db: Database.Database = getDb()) {
  ensureAdminAgentStewards(db);
  const row = profileRowByKey(key(profileKey), db);
  return row ? mapRow(row, db) : null;
}

export function getAgentProfileById(profileId: string, db: Database.Database = getDb()) {
  ensureAdminAgentStewards(db);
  const row = profileRowById(text(profileId, 200), db);
  return row ? mapRow(row, db) : null;
}

export function upsertAgentProfile(input: UpsertAgentProfileInput, db: Database.Database = getDb()) {
  const profileKey = key(input.key);
  if (profileKey === adminAgentProfileKey) throw new Error('ADMIN_AGENT_PROFILE_PROTECTED');
  const name = text(input.name, 160);
  if (!name) throw new Error('AGENT_PROFILE_NAME_REQUIRED');
  const existing = profileRowByKey(profileKey, db);
  const ownerType = input.ownerType ?? existing?.owner_type ?? 'user';
  const ownerUserId = ownerType === 'user' ? text(input.ownerUserId ?? existing?.owner_user_id, 200) || null : null;
  const ownerAgentProfileId = ownerType === 'agent' ? text(input.ownerAgentProfileId ?? existing?.owner_agent_profile_id, 200) || null : null;
  assertOwner({ ownerType, ownerUserId, ownerAgentProfileId, profileId: existing?.id }, db);
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const nextVersion = existing ? existing.version + 1 : 1;
  const status = input.status ?? existing?.status ?? 'draft';
  const persona = input.persona ?? (existing ? jsonRecord(existing.persona_json) : { name, instructions: '' });
  const skills = Array.from(new Set((input.skills ?? (existing ? jsonStrings(existing.skills_json) : [])).map((item) => text(item, 160)).filter(Boolean)));
  const memoryScope = input.memoryScope ?? (existing ? jsonRecord(existing.memory_scope_json) : {});
  const authority = input.authority ?? (existing ? jsonRecord(existing.authority_json) : { mode: 'propose' });
  const contextPolicy = input.contextPolicy ?? (existing ? jsonRecord(existing.context_policy_json) : { continuation: 'session', handoff: null });
  const runtimeProfileKey = text(input.runtimeProfileKey ?? existing?.runtime_profile_key, 120) || null;
  if (runtimeProfileKey && !db.prepare('SELECT 1 FROM runtime_profiles WHERE key = ?').get(runtimeProfileKey)) throw new Error('RUNTIME_PROFILE_NOT_FOUND');
  const createdByUserId = text(input.createdByUserId ?? existing?.created_by_user_id, 200) || null;
  const stewardUserIds = Array.from(new Set((input.stewardUserIds ?? []).map((item) => text(item, 200)).filter(Boolean)));
  if (ownerType === 'user' && ownerUserId && !stewardUserIds.includes(ownerUserId)) stewardUserIds.unshift(ownerUserId);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO agent_profiles (id, key, name, description, status, system_key, owner_type, owner_user_id,
        owner_agent_profile_id, persona_json, runtime_profile_key, skills_json, memory_scope_json, authority_json,
        context_policy_json, version, created_by_user_id, created_at, updated_at)
      VALUES (@id, @key, @name, @description, @status, NULL, @ownerType, @ownerUserId, @ownerAgentProfileId,
        @persona, @runtimeProfileKey, @skills, @memoryScope, @authority, @contextPolicy, @version,
        @createdByUserId, @createdAt, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET name=excluded.name, description=excluded.description, status=excluded.status,
        owner_type=excluded.owner_type, owner_user_id=excluded.owner_user_id,
        owner_agent_profile_id=excluded.owner_agent_profile_id, persona_json=excluded.persona_json,
        runtime_profile_key=excluded.runtime_profile_key, skills_json=excluded.skills_json,
        memory_scope_json=excluded.memory_scope_json, authority_json=excluded.authority_json,
        context_policy_json=excluded.context_policy_json, version=excluded.version, updated_at=excluded.updated_at
    `).run({ id, key: profileKey, name, description: text(input.description ?? existing?.description, 2000) || null,
      status, ownerType, ownerUserId, ownerAgentProfileId, persona: JSON.stringify(persona), runtimeProfileKey,
      skills: JSON.stringify(skills), memoryScope: JSON.stringify(memoryScope), authority: JSON.stringify(authority),
      contextPolicy: JSON.stringify(contextPolicy), version: nextVersion, createdByUserId,
      createdAt: existing?.created_at ?? now, updatedAt: now });
    db.prepare('DELETE FROM agent_profile_stewards WHERE profile_id = ?').run(id);
    const insertSteward = db.prepare('INSERT INTO agent_profile_stewards (profile_id, user_id, role, created_at) VALUES (?, ?, ?, ?)');
    for (const userId of stewardUserIds) {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new Error('AGENT_PROFILE_STEWARD_NOT_FOUND');
      insertSteward.run(id, userId, ownerType === 'user' && userId === ownerUserId ? 'owner' : 'steward', now);
    }
    const record = mapRow(profileRowById(id, db)!, db);
    db.prepare('INSERT INTO agent_profile_versions (profile_id, version, snapshot_json, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, nextVersion, JSON.stringify(snapshot(record)), createdByUserId, now);
  })();
  return getAgentProfile(profileKey, db)!;
}

export function upsertAgentProfileBinding(input: {
  profileId: string; surfaceType: AgentProfileBinding['surfaceType']; surfaceKey: string; label?: string | null;
  enabled?: boolean; configuration?: Record<string, unknown>; createdByUserId?: string | null;
}, db: Database.Database = getDb()) {
  if (!profileRowById(input.profileId, db)) throw new Error('AGENT_PROFILE_NOT_FOUND');
  const surfaceKey = text(input.surfaceKey, 300);
  if (!surfaceKey) throw new Error('AGENT_PROFILE_BINDING_KEY_REQUIRED');
  const now = new Date().toISOString();
  const current = db.prepare('SELECT id, created_at FROM agent_profile_bindings WHERE surface_type = ? AND surface_key = ?').get(input.surfaceType, surfaceKey) as { id: string; created_at: string } | undefined;
  const id = current?.id ?? randomUUID();
  db.prepare(`
    INSERT INTO agent_profile_bindings (id, profile_id, surface_type, surface_key, label, enabled, configuration_json,
      created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(surface_type, surface_key) DO UPDATE SET profile_id=excluded.profile_id, label=excluded.label,
      enabled=excluded.enabled, configuration_json=excluded.configuration_json, updated_at=excluded.updated_at
  `).run(id, input.profileId, input.surfaceType, surfaceKey, text(input.label, 300) || null, input.enabled === false ? 0 : 1,
    JSON.stringify(input.configuration ?? {}), input.createdByUserId ?? null, current?.created_at ?? now, now);
  return bindingRows(input.profileId, db).find((binding) => binding.id === id)!;
}

export function resolveAgentProfileBinding(surfaceType: AgentProfileBinding['surfaceType'], surfaceKey: string, db: Database.Database = getDb()) {
  const row = db.prepare('SELECT profile_id FROM agent_profile_bindings WHERE surface_type = ? AND surface_key = ? AND enabled = 1').get(surfaceType, text(surfaceKey, 300)) as { profile_id: string } | undefined;
  return row ? getAgentProfileById(row.profile_id, db) : null;
}

export function assignAgentProfileToSession(input: {
  sessionId: string;
  profileId: string;
  conversationScope: AgentConversationScope;
}, db: Database.Database = getDb()) {
  const profile = getAgentProfileById(input.profileId, db);
  if (!profile || profile.status !== 'active') throw new Error('AGENT_PROFILE_UNAVAILABLE');
  const result = db.prepare(`
    UPDATE agent_sessions SET agent_profile_id = ?, agent_profile_version = ?, conversation_scope = ?, updated_at = ?
    WHERE id = ? AND (agent_profile_id IS NULL OR agent_profile_id = ?)
  `).run(profile.id, profile.version, input.conversationScope, new Date().toISOString(), input.sessionId, profile.id);
  if (!result.changes) throw new Error('AGENT_SESSION_PROFILE_MISMATCH');
  return { profileId: profile.id, profileVersion: profile.version, conversationScope: input.conversationScope };
}

export function getAgentSessionProfileAssignment(sessionId: string, db: Database.Database = getDb()) {
  const row = db.prepare(`
    SELECT agent_profile_id, agent_profile_version, conversation_scope
    FROM agent_sessions WHERE id = ?
  `).get(text(sessionId, 200)) as {
    agent_profile_id: string | null;
    agent_profile_version: number | null;
    conversation_scope: AgentConversationScope | null;
  } | undefined;
  return row ? {
    profileId: row.agent_profile_id,
    profileVersion: row.agent_profile_version,
    conversationScope: row.conversation_scope,
  } : null;
}

export function listAgentProfileSessions(profileId: string, limit = 100, db: Database.Database = getDb()): AgentProfileSessionSummary[] {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  return (db.prepare(`
    SELECT s.id, s.source, s.status, s.title, s.conversation_scope, s.created_by_user_id,
      p.display_name AS created_by_display_name, s.linked_change_request_id,
      cr.request_number, cr.title AS request_title,
      (SELECT COUNT(*) FROM agent_messages am WHERE am.session_id = s.id) AS message_count,
      s.last_message_at, s.created_at, s.updated_at
    FROM agent_sessions s
    LEFT JOIN profiles p ON p.user_id = s.created_by_user_id
    LEFT JOIN change_requests cr ON cr.id = s.linked_change_request_id
    WHERE s.agent_profile_id = ?
    ORDER BY COALESCE(s.last_message_at, s.updated_at) DESC, s.id DESC LIMIT ?
  `).all(profileId, boundedLimit) as Array<{
    id: string; source: string; status: string; title: string | null; conversation_scope: AgentConversationScope | null;
    created_by_user_id: string | null; created_by_display_name: string | null; linked_change_request_id: string | null;
    request_number: number | null; request_title: string | null; message_count: number;
    last_message_at: string | null; created_at: string; updated_at: string;
  }>).map((row) => ({
    id: row.id, source: row.source, status: row.status, title: row.title,
    conversationScope: row.conversation_scope ?? 'individual', createdByUserId: row.created_by_user_id,
    createdByDisplayName: row.created_by_display_name, linkedChangeRequestId: row.linked_change_request_id,
    linkedRequestNumber: row.request_number, linkedRequestTitle: row.request_title, messageCount: row.message_count,
    lastMessageAt: row.last_message_at, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export function listAgentProfileActivity(profileId: string, limit = 100, db: Database.Database = getDb()): AgentProfileActivityItem[] {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  const sessions = listAgentProfileSessions(profileId, boundedLimit, db).map((session) => ({
    id: `session:${session.id}`,
    kind: 'session' as const,
    occurredAt: session.lastMessageAt ?? session.updatedAt,
    title: session.title || `${session.source} session`,
    description: `${session.conversationScope} ${session.source} conversation · ${session.messageCount} message${session.messageCount === 1 ? '' : 's'}`,
    status: session.status,
    sessionId: session.id,
    requestId: session.linkedChangeRequestId,
    requestNumber: session.linkedRequestNumber,
    requestTitle: session.linkedRequestTitle,
    workflowStepKey: null,
    executionMode: null,
    actorDisplayName: session.createdByDisplayName,
  }));
  const runs = (db.prepare(`
    SELECT ar.id, ar.status, ar.kind, ar.session_id, ar.request_id, ar.workflow_step_key,
      ar.execution_mode, COALESCE(ar.finished_at, ar.started_at, ar.created_at) AS occurred_at,
      cr.request_number, cr.title AS request_title, p.display_name AS actor_display_name
    FROM agent_runs ar
    LEFT JOIN change_requests cr ON cr.id = ar.request_id
    LEFT JOIN agent_sessions s ON s.id = ar.session_id
    LEFT JOIN profiles p ON p.user_id = s.created_by_user_id
    WHERE ar.agent_profile_id = ?
    ORDER BY occurred_at DESC, ar.id DESC LIMIT ?
  `).all(profileId, boundedLimit) as Array<{
    id: string; status: string; kind: string; session_id: string | null; request_id: string | null;
    workflow_step_key: string | null; execution_mode: string | null; occurred_at: string;
    request_number: number | null; request_title: string | null; actor_display_name: string | null;
  }>).map((run) => ({
    id: `run:${run.id}`,
    kind: 'run' as const,
    occurredAt: run.occurred_at,
    title: run.workflow_step_key ? `Executed ${run.workflow_step_key}` : `Ran ${run.kind}`,
    description: run.request_number ? `Request #${run.request_number}${run.request_title ? ` · ${run.request_title}` : ''}` : run.kind,
    status: run.status,
    sessionId: run.session_id,
    requestId: run.request_id,
    requestNumber: run.request_number,
    requestTitle: run.request_title,
    workflowStepKey: run.workflow_step_key,
    executionMode: run.execution_mode,
    actorDisplayName: run.actor_display_name,
  }));
  return [...sessions, ...runs]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
    .slice(0, boundedLimit);
}

export function getAgentProfileSessionDetail(profileId: string, sessionId: string, db: Database.Database = getDb()): AgentProfileSessionDetail | null {
  const session = listAgentProfileSessions(profileId, 200, db).find((candidate) => candidate.id === sessionId);
  if (!session) return null;
  const assignment = getAgentSessionProfileAssignment(sessionId, db);
  const messages = (db.prepare(`
    SELECT id, role, source, source_message_id, content, meta_json, created_at
    FROM agent_messages WHERE session_id = ? ORDER BY created_at, id LIMIT 500
  `).all(sessionId) as Array<{
    id: string; role: string; source: string; source_message_id: string | null;
    content: string; meta_json: string; created_at: string;
  }>).map((message) => {
    const meta = jsonRecord(message.meta_json);
    return {
      id: message.id, role: message.role, source: message.source, sourceMessageId: message.source_message_id,
      content: message.content, authorId: text(meta.authorId ?? meta.authorPubkey, 300) || null,
      authorName: text(meta.authorName, 300) || null, createdAt: message.created_at,
    };
  });
  const runs = (db.prepare(`
    SELECT ar.id, ar.kind, ar.status, ar.request_id, cr.request_number, ar.workflow_step_key,
      ar.execution_mode, ar.error_message, ar.created_at, ar.started_at, ar.finished_at
    FROM agent_runs ar LEFT JOIN change_requests cr ON cr.id = ar.request_id
    WHERE ar.session_id = ? AND ar.agent_profile_id = ? ORDER BY ar.created_at, ar.id LIMIT 500
  `).all(sessionId, profileId) as Array<{
    id: string; kind: string; status: string; request_id: string | null; request_number: number | null;
    workflow_step_key: string | null; execution_mode: string | null; error_message: string | null;
    created_at: string; started_at: string | null; finished_at: string | null;
  }>).map((run) => ({
    id: run.id, kind: run.kind, status: run.status, requestId: run.request_id, requestNumber: run.request_number,
    workflowStepKey: run.workflow_step_key, executionMode: run.execution_mode, errorMessage: run.error_message,
    createdAt: run.created_at, startedAt: run.started_at, finishedAt: run.finished_at,
  }));
  return { ...session, profileId, profileVersion: assignment?.profileVersion ?? null, messages, runs };
}
