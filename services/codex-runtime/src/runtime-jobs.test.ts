import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const contractVersion = '2026-07-10';

async function waitForServer(url: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not become healthy at ${url}`);
}

async function pollJob(baseUrl: string, jobId: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/v1/runtime/jobs/${jobId}`);
    const payload = await response.json() as { job: { status: string } };
    if (payload.job.status !== 'queued' && payload.job.status !== 'running') return payload;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Runtime job ${jobId} did not finish`);
}

test('normalized runtime jobs support discovery, completion, and cancellation', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-runtime-jobs-'));
  const fakeCodex = path.join(tempDir, 'fake-codex.mjs');
  const port = 32_000 + Math.floor(Math.random() * 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const repoRoot = path.resolve(process.cwd(), '../..');
  let server: ChildProcess | null = null;

  await fs.writeFile(fakeCodex, `#!/usr/bin/env node
import fs from 'node:fs/promises';
const args = process.argv.slice(2);
const outputIndex = args.indexOf('-o');
const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : null;
const prompt = args.at(-1) || '';
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread' }));
if (prompt.includes('WAIT_FOR_CANCEL')) await new Promise((resolve) => setTimeout(resolve, 30000));
if (outputFile) await fs.writeFile(outputFile, 'NORMALIZED_OK');
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'NORMALIZED_OK' } }));
`, { mode: 0o700 });

  t.after(async () => {
    server?.kill('SIGTERM');
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  server = spawn(process.execPath, [path.resolve(process.cwd(), 'dist/index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      CODEX_BIN: fakeCodex,
      CODEX_RUNTIME_ENABLED: 'true',
      CODEX_IMAGE_GENERATION_ENABLED: 'false',
      CODEX_WORKSPACE_ROOT: repoRoot,
      CODEX_TARGET_WORKSPACE_ROOT: path.join(tempDir, 'workspaces'),
      CODEX_RUNTIME_TIMEOUT_MS: '60000',
      PRISM_GATEWAY_ENABLED: 'false',
      APP_API_BASE_URL: '',
      APP_API_SERVICE_TOKEN: '',
      PRISM_API_BASE: '',
      PRISM_API_KEY: '',
      PRISM_API_READ_KEY: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitForServer(`${baseUrl}/health`);

  const manifest = await fetch(`${baseUrl}/v1/runtime/manifest`).then((response) => response.json()) as {
    features: { cancellation: boolean };
    endpoints: Record<string, string>;
  };
  assert.equal(manifest.features.cancellation, true);
  assert.equal(manifest.endpoints.runtimeJobs, '/v1/runtime/jobs');

  const capabilities = await fetch(`${baseUrl}/v1/runtime/capabilities`).then((response) => response.json()) as {
    contractVersion: string;
    features: string[];
  };
  assert.equal(capabilities.contractVersion, contractVersion);
  assert.ok(capabilities.features.includes('cancellation'));

  const oversizedBody = JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) });
  const oversizedStandardRequest = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: oversizedBody,
  });
  assert.equal(oversizedStandardRequest.status, 413);

  const invalid = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contractVersion: 'invalid', prompt: 'test', sessionId: 'invalid-version' }),
  });
  assert.equal(invalid.status, 400);

  const accepted = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contractVersion,
      prompt: 'Return the test response',
      sessionId: 'normalized-success',
      skills: [{ name: 'test-skill' }],
    }),
  }).then((response) => response.json()) as { jobId: string };
  const completed = await pollJob(baseUrl, accepted.jobId) as {
    job: { status: string; result: { responseText: string; continuationId: string } };
  };
  assert.equal(completed.job.status, 'succeeded');
  assert.equal(completed.job.result.responseText, 'NORMALIZED_OK');
  assert.equal(completed.job.result.continuationId, 'fake-thread');

  const completedCancel = await fetch(`${baseUrl}/v1/runtime/jobs/${accepted.jobId}/cancel`, { method: 'POST' })
    .then((response) => response.json()) as { job: { status: string } };
  assert.equal(completedCancel.job.status, 'succeeded');

  const waiting = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contractVersion, prompt: 'WAIT_FOR_CANCEL', sessionId: 'normalized-cancel' }),
  }).then((response) => response.json()) as { jobId: string };

  const runningDeadline = Date.now() + 5_000;
  while (Date.now() < runningDeadline) {
    const status = await fetch(`${baseUrl}/v1/runtime/jobs/${waiting.jobId}`)
      .then((response) => response.json()) as { job: { status: string } };
    if (status.job.status === 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const canceled = await fetch(`${baseUrl}/v1/runtime/jobs/${waiting.jobId}/cancel`, { method: 'POST' })
    .then((response) => response.json()) as { job: { status: string; error: { code: string } } };
  assert.equal(canceled.job.status, 'canceled');
  assert.equal(canceled.job.error.code, 'RUNTIME_JOB_CANCELED');

  await new Promise((resolve) => setTimeout(resolve, 200));
  const afterCancel = await fetch(`${baseUrl}/v1/runtime/jobs/${waiting.jobId}`)
    .then((response) => response.json()) as { job: { status: string } };
  assert.equal(afterCancel.job.status, 'canceled');

  const legacy = await fetch(`${baseUrl}/v1/responses/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Return the compatibility response', sessionId: 'compatibility-success' }),
  }).then((response) => response.json()) as { jobId: string };
  const legacyDeadline = Date.now() + 10_000;
  type LegacyJobPayload = { job: { status: string }; response?: { responseText?: string } };
  let legacyPayload: LegacyJobPayload | null = null;
  while (Date.now() < legacyDeadline) {
    legacyPayload = await fetch(`${baseUrl}/v1/responses/jobs/${legacy.jobId}`)
      .then((response) => response.json()) as LegacyJobPayload;
    if (legacyPayload && legacyPayload.job.status !== 'queued' && legacyPayload.job.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(legacyPayload?.job.status, 'succeeded');
  assert.equal(legacyPayload?.response?.responseText, 'NORMALIZED_OK');
});
