import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('creation context binds a recorded agent profile and exact initiating message', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'prism-creator-'));
  process.env.PRISM_AGENT_DATA_ROOT = root;
  process.env.ADMIN_PASSWORD = 'test-site-only-signing-key';
  const core = await import('./app-core');
  const { mintRequestCreationContext, verifyRequestCreationContext } = await import('./request-creation-context');
  try {
    core.runMigrations();
    const db = core.getDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO agent_profiles (id, key, name, owner_type, created_at, updated_at)
      VALUES ('profile-1', 'dreamer', 'Dreamer', 'workspace', ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO agent_sessions (id, source, agent_profile_id, created_at, updated_at)
      VALUES ('session-1', 'discord', 'profile-1', ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO agent_messages (id, session_id, role, source, source_message_id, content, created_at, updated_at)
      VALUES ('message-1', 'session-1', 'user', 'discord', 'external-1', 'create request', ?, ?)`).run(now, now);
    const token = mintRequestCreationContext({ sessionId: 'session-1', metadata: {
      requestOrigin: { sourceSessionId: 'session-1', sourceMessageId: 'external-1' },
    } });
    assert.ok(token);
    const context = verifyRequestCreationContext(token);
    assert.equal(context?.creator.id, 'dreamer');
    assert.equal(context?.creator.sourceMessageRecordId, 'message-1');
    assert.equal(context?.sourceMessageId, 'external-1');
    assert.throws(() => core.createChangeRequest({
      title: 'Unattributed', description: 'No creator', workflowKey: 'change-request-default', requestType: 'ops',
    }), /REQUEST_CREATOR_REQUIRED/);
    const created = core.createChangeRequest({
      title: 'Attributed', description: 'Specific agent creator', workflowKey: 'change-request-default',
      requestType: 'ops', source: 'discord', sourceSessionId: 'session-1', sourceMessageId: 'external-1',
      creator: context!.creator,
    });
    assert.ok(created);
    assert.equal(created.origin?.creator?.id, 'dreamer');
    assert.equal(created.origin?.creator?.sourceMessageRecordId, 'message-1');
    assert.equal(verifyRequestCreationContext(`${token}tampered`), null);
    assert.equal(mintRequestCreationContext({ sessionId: 'session-1', metadata: {
      requestOrigin: { sourceSessionId: 'other-session', sourceMessageId: 'external-1' },
    } }), null);
  } finally {
    core.closeDb();
    rmSync(root, { recursive: true, force: true });
    delete process.env.PRISM_AGENT_DATA_ROOT;
    delete process.env.ADMIN_PASSWORD;
  }
});
