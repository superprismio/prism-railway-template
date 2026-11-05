import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('request list derives attention from compact agent run fields and clears it after success', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'prism-attention-list-'));
  process.env.PRISM_AGENT_DATA_ROOT = dataRoot;
  const core = await import('./index');
  try {
    core.runMigrations();
    const db = core.getDb();
    const early = '2026-11-05T12:00:00.000Z';
    const later = '2026-11-05T12:01:00.000Z';
    const request = db.prepare(`INSERT INTO change_requests (
      id, request_number, workflow_key, title, description, request_type, source, created_at, updated_at
    ) VALUES (?, ?, 'test-workflow', 'Test', 'Test', 'normal', 'test', ?, ?)`);
    request.run('blocked-request', 9001, early, early);
    request.run('cleared-request', 9002, early, early);
    const run = db.prepare(`INSERT INTO workflow_runs (
      id, request_id, workflow_key, current_step_key, status, created_at, updated_at
    ) VALUES (?, ?, 'test-workflow', 'inspect', 'active', ?, ?)`);
    run.run('blocked-workflow', 'blocked-request', early, early);
    run.run('cleared-workflow', 'cleared-request', early, early);
    const agent = db.prepare(`INSERT INTO agent_runs (
      id, kind, status, request_id, workflow_run_id, workflow_step_key,
      result_json, input_json, trace_json, finished_at, created_at, updated_at
    ) VALUES (?, 'workflow_step', ?, ?, ?, 'inspect', ?, ?, ?, ?, ?, ?)`);
    const blockedOutcome = JSON.stringify({ workflowOutcome: {
      status: 'blocked', summary: 'Provider unavailable', blockers: [{ key: 'provider-down' }],
    } });
    agent.run('blocked-agent', 'succeeded', 'blocked-request', 'blocked-workflow', blockedOutcome,
      '{}', JSON.stringify([{ padding: 'x'.repeat(100_000) }]), early, early, early);
    agent.run('cleared-agent-old', 'succeeded', 'cleared-request', 'cleared-workflow', blockedOutcome,
      '{}', '[]', early, early, early);
    agent.run('cleared-agent-new', 'succeeded', 'cleared-request', 'cleared-workflow', '{}',
      '{}', '[]', later, later, later);

    const listed = core.listChangeRequests();
    assert.equal(listed.find((item) => item.id === 'blocked-request')?.workflowAttention?.summary, 'Provider unavailable');
    assert.equal(listed.find((item) => item.id === 'cleared-request')?.workflowAttention, null);
  } finally {
    core.closeDb();
    rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.PRISM_AGENT_DATA_ROOT;
  }
});
