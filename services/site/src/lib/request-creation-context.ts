import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadConfig } from './app-core/config';
import { getDb } from './app-core/db';
import type { RequestCreator } from './app-core/request-origin';

type CreationContext = {
  creator: RequestCreator;
  sourceSessionId: string;
  sourceMessageId: string | null;
  issuedAt: number;
};

function string(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function signature(payload: string) {
  return createHmac('sha256', loadConfig().adminPassword).update(`request-creator-v1:${payload}`).digest('base64url');
}

/** Site owns this identity resolution. Caller-supplied profile names are never persisted. */
export function mintRequestCreationContext(input: { sessionId: string; metadata?: Record<string, unknown> }) {
  const db = getDb();
  const session = db.prepare('SELECT id, agent_profile_id, agent_profile_version FROM agent_sessions WHERE id = ?')
    .get(input.sessionId) as { id: string; agent_profile_id: string | null; agent_profile_version: number | null } | undefined;
  if (!session) return null;
  const meta = record(input.metadata);
  const runId = string(meta.agentRunId);
  const run = runId ? db.prepare('SELECT id, session_id, agent_profile_id, agent_profile_version, request_id FROM agent_runs WHERE id = ?')
    .get(runId) as { id: string; session_id: string | null; agent_profile_id: string | null; agent_profile_version: number | null; request_id: string | null } | undefined : null;
  if (runId && (!run || run.session_id !== session.id)) return null;
  const profileId = run?.agent_profile_id ?? session.agent_profile_id;
  const profile = profileId ? db.prepare('SELECT id, key, name, version FROM agent_profiles WHERE id = ?')
    .get(profileId) as { id: string; key: string; name: string; version: number } | undefined : null;
  if (!profile) return null;
  const requestedOrigin = record(meta.requestOrigin);
  const requestedSourceMessageId = string(requestedOrigin.sourceMessageId);
  if (string(requestedOrigin.sourceSessionId) && requestedOrigin.sourceSessionId !== session.id) return null;
  const message = requestedSourceMessageId
    ? db.prepare(`SELECT id, source_message_id FROM agent_messages WHERE session_id = ? AND role = 'user' AND source_message_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(session.id, requestedSourceMessageId) as { id: string; source_message_id: string | null } | undefined
    : string(meta.sourceMessageRecordId)
      ? db.prepare(`SELECT id, source_message_id FROM agent_messages WHERE session_id = ? AND role = 'user' AND id = ?`)
        .get(session.id, meta.sourceMessageRecordId) as { id: string; source_message_id: string | null } | undefined
      : null;
  if ((requestedSourceMessageId || string(meta.sourceMessageRecordId)) && !message) return null;
  const context: CreationContext = {
    creator: { type: 'agent', id: profile.key, displayName: profile.name,
      basis: run ? 'recorded-agent-run' : 'assigned-session-profile',
      agentRunId: run?.id ?? null, parentRequestId: run?.request_id ?? null,
      sourceMessageRecordId: message?.id ?? null },
    sourceSessionId: session.id,
    sourceMessageId: message?.source_message_id ?? null,
    issuedAt: Date.now(),
  };
  const payload = Buffer.from(JSON.stringify(context)).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyRequestCreationContext(token: string | null) {
  if (!token) return null;
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra) return null;
  const expected = signature(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as CreationContext;
    if (Date.now() - value.issuedAt > 24 * 60 * 60 * 1000 || value.issuedAt > Date.now() + 60_000) return null;
    if (value.creator?.type !== 'agent' || !string(value.creator.id) || !string(value.sourceSessionId)) return null;
    return value;
  } catch { return null; }
}
