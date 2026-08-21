import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('createAgentRun persists an explicit immutable executor snapshot', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'prism-agent-executor-'));
  process.env.PRISM_AGENT_DATA_ROOT = dataRoot;
  const core = await import('./index');
  try {
    core.runMigrations();
    const admin = core.getAgentProfile('admin-agent');
    assert.ok(admin);
    const run = core.createAgentRun({
      kind: 'workflow_step',
      status: 'queued',
      requestId: null,
      agentProfileId: admin.id,
      agentProfileVersion: admin.version,
      executionMode: 'orchestrator',
      input: { prompt: 'bounded test' },
    });
    assert.equal(run?.agentProfileId, admin.id);
    assert.equal(run?.agentProfileVersion, admin.version);
    assert.equal(run?.executionMode, 'orchestrator');
  } finally {
    core.closeDb();
    rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.PRISM_AGENT_DATA_ROOT;
  }
});
