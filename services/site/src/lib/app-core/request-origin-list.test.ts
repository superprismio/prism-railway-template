import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publicUrlFromRequest } from '../public-url';

test('request listing filters by exact origin session and message, including completed requests', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'prism-origin-list-'));
  process.env.PRISM_AGENT_DATA_ROOT = dataRoot;
  const core = await import('./index');
  try {
    core.runMigrations();
    const db = core.getDb();
    const now = '2026-09-23T16:28:08.364Z';
    const insertRequest = db.prepare(`INSERT INTO change_requests (
      id, request_number, workflow_key, title, description, request_type,
      source, created_at, updated_at, completed_at, closed_at
    ) VALUES (?, ?, 'app-builder-delivery', 'test', 'test', 'normal', 'discord', ?, ?, ?, ?)`);
    const insertOrigin = db.prepare(`INSERT INTO request_origins (
      request_id, source_session_id, platform, target_id, thread_id,
      source_message_id, backfill_status, captured_at
    ) VALUES (?, ?, 'discord', 'channel-1', 'thread-1', ?, 'complete', ?)`);
    insertRequest.run('req-1', 3092, now, now, null, null);
    insertOrigin.run('req-1', 'session-1', 'message-1', now);
    insertRequest.run('req-2', 3093, now, now, now, now);
    insertOrigin.run('req-2', 'session-1', 'message-2', now);
    insertRequest.run('req-3', 3094, now, now, null, null);
    insertOrigin.run('req-3', 'session-2', 'message-1', now);

    assert.deepEqual(core.listChangeRequests({ sourceSessionId: 'session-1', sourceMessageId: 'message-1' }).map((item) => item.requestNumber), [3092]);
    assert.deepEqual(core.listChangeRequests({ sourceSessionId: 'session-1', sourceMessageId: 'message-2' }).map((item) => item.requestNumber), [3093]);
    assert.deepEqual(core.listChangeRequests({ sourceSessionId: 'session-1' }).map((item) => item.requestNumber), [3092, 3093]);
    assert.throws(() => core.listChangeRequests({ sourceMessageId: 'message-1' }), /SOURCE_SESSION_REQUIRED/);
  } finally {
    core.closeDb();
    rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.PRISM_AGENT_DATA_ROOT;
  }
});

test('Site supplies a public request link from its existing Railway domain configuration', () => {
  const names = ['SITE_PUBLIC_URL', 'PUBLIC_SITE_URL', 'NEXT_PUBLIC_SITE_URL', 'APP_URL', 'RAILWAY_PUBLIC_DOMAIN'] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.RAILWAY_PUBLIC_DOMAIN = 'prism.raidguild.org';
    const privateRequest = new Request('http://site.railway.internal:3100/agent/change-board/requests');
    assert.equal(
      publicUrlFromRequest(privateRequest, '/admin/lab/requests/3092#selected-request-workspace'),
      'https://prism.raidguild.org/admin/lab/requests/3092#selected-request-workspace',
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
