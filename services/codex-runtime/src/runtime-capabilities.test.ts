import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RuntimeCapabilityError,
  RuntimeCapabilitySessions,
} from './runtime-capabilities.js';

test('runtime capability sessions enforce job assignment and expiry', async () => {
  let now = 1000;
  const calls: Array<Record<string, unknown>> = [];
  const sessions = new RuntimeCapabilitySessions({
    invoke: async (input) => {
      calls.push(input as unknown as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        traceId: 'trace-runtime',
        capability: input.capability,
        result: { results: [] },
      };
    },
  }, () => now);
  const token = sessions.create(
    ['plausible.stats.query'],
    { requestId: '349', runtimeJobId: 'job-1' },
    5000,
  );

  const result = await sessions.invoke(token, 'plausible.stats.query', {
    metrics: ['visitors'],
    date_range: '7d',
  });
  assert.equal(result.traceId, 'trace-runtime');
  assert.equal(calls.length, 1);

  await assert.rejects(
    sessions.invoke(token, 'crm.contact.read', {}),
    (error: unknown) =>
      error instanceof RuntimeCapabilityError &&
      error.code === 'RUNTIME_CAPABILITY_NOT_ASSIGNED' &&
      error.status === 403,
  );

  now = 7000;
  await assert.rejects(
    sessions.invoke(token, 'plausible.stats.query', {}),
    (error: unknown) =>
      error instanceof RuntimeCapabilityError &&
      error.code === 'RUNTIME_CAPABILITY_SESSION_EXPIRED',
  );
});

test('revoked runtime capability sessions cannot be reused', async () => {
  const sessions = new RuntimeCapabilitySessions({
    invoke: async () => {
      throw new Error('should not invoke');
    },
  });
  const token = sessions.create(['plausible.stats.query'], {}, 5000);
  sessions.revoke(token);

  await assert.rejects(
    sessions.invoke(token, 'plausible.stats.query', {}),
    (error: unknown) =>
      error instanceof RuntimeCapabilityError &&
      error.code === 'RUNTIME_CAPABILITY_SESSION_INVALID',
  );
});
