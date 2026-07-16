import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { requestRuntimeResponseWithProfile } from './runtime-client';
import type { RuntimeProfileRecord } from './runtime-profiles';

test('runtime client uses the normalized contract without adapter-specific parsing', async (t) => {
  const submitted: { body?: Record<string, unknown> } = {};
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/runtime/jobs') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        submitted.body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        response.writeHead(202, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, jobId: 'job-1', job: { id: 'job-1', status: 'queued' } }));
      });
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/runtime/jobs/job-1') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        job: {
          id: 'job-1',
          status: 'succeeded',
          result: {
            responseText: 'GROK_NORMALIZED_OK',
            continuationId: 'grok-session-1',
            providerMetadata: { model: 'grok-build' },
          },
          trace: [{ at: '2026-07-13T00:00:00.000Z', kind: 'run.completed', message: 'done' }],
        },
      }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const profile: RuntimeProfileRecord = {
    key: 'grok-local',
    name: 'Grok Build',
    adapter: 'grok-build',
    baseUrl: `http://127.0.0.1:${address.port}`,
    enabled: true,
    isDefault: true,
    contractVersion: '2026-07-10',
    features: ['continuations'],
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
  const result = await requestRuntimeResponseWithProfile(profile, {
    prompt: 'test',
    sessionId: 'site-session',
    continuationId: 'existing-session',
    skills: ['test-skill'],
    credentials: ['sendgrid'],
    timeoutMs: 10_000,
  });

  assert.equal(result.responseText, 'GROK_NORMALIZED_OK');
  assert.equal(result.thread_id, 'grok-session-1');
  assert.equal(result.provider, 'grok-build');
  assert.equal(result.runtimeKey, 'grok-local');
  assert.equal(submitted.body?.contractVersion, '2026-07-10');
  assert.equal(submitted.body?.continuationId, 'existing-session');
  assert.deepEqual(submitted.body?.skills, [{ name: 'test-skill' }]);
  assert.deepEqual(submitted.body?.credentials, [{ key: 'sendgrid' }]);
});
