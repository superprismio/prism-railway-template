import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayClientError, PrismGatewayClient } from './gateway-client.js';

test('gateway client keeps the service token in the parent request', async () => {
  let observedToken = '';
  let observedBody: Record<string, unknown> = {};
  const client = new PrismGatewayClient(
    {
      enabled: true,
      baseUrl: 'http://prism-gateway.internal:3040',
      token: 'runtime-secret',
      timeoutMs: 5000,
    },
    (async (_url, init) => {
      observedToken = new Headers(init?.headers).get('x-gateway-token') || '';
      observedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        status: 200,
        traceId: 'trace-1',
        capability: 'plausible.stats.query',
        result: { results: [] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  );

  const result = await client.invoke({
    capability: 'plausible.stats.query',
    input: { metrics: ['visitors'], date_range: '7d' },
    context: { requestId: '349', workflowStepKey: 'synthesize' },
  });

  assert.equal(observedToken, 'runtime-secret');
  assert.equal(observedBody.capability, 'plausible.stats.query');
  assert.equal(result.traceId, 'trace-1');
  assert.deepEqual(result.result, { results: [] });
});

test('gateway client preserves policy failures without exposing credentials', async () => {
  const client = new PrismGatewayClient(
    {
      enabled: true,
      baseUrl: 'http://prism-gateway.internal:3040',
      token: 'runtime-secret',
      timeoutMs: 5000,
    },
    (async () => new Response(JSON.stringify({
      ok: false,
      status: 403,
      traceId: 'trace-denied',
      capability: 'plausible.stats.query',
      error: {
        code: 'CAPABILITY_POLICY_DENIED',
        message: 'CAPABILITY_POLICY_DENIED',
        retryable: false,
      },
    }), { status: 403, headers: { 'content-type': 'application/json' } })) as typeof fetch,
  );

  await assert.rejects(
    client.invoke({ capability: 'plausible.stats.query', input: {} }),
    (error: unknown) => {
      assert(error instanceof GatewayClientError);
      assert.equal(error.code, 'CAPABILITY_POLICY_DENIED');
      assert.equal(error.status, 403);
      assert.equal(error.traceId, 'trace-denied');
      assert(!error.message.includes('runtime-secret'));
      return true;
    },
  );
});

test('gateway client is inert while the runtime flag is disabled', async () => {
  const client = new PrismGatewayClient({
    enabled: false,
    baseUrl: 'http://prism-gateway.internal:3040',
    token: 'runtime-secret',
    timeoutMs: 5000,
  });

  assert.deepEqual(client.status(), { enabled: false, configured: true });
  await assert.rejects(
    client.invoke({ capability: 'plausible.stats.query', input: {} }),
    (error: unknown) => error instanceof GatewayClientError && error.code === 'PRISM_GATEWAY_DISABLED',
  );
});

test('gateway client leases generic credential bundles for trusted runtime jobs', async () => {
  let observedBody: Record<string, unknown> = {};
  const client = new PrismGatewayClient(
    { enabled: true, baseUrl: 'http://prism-gateway.internal:3040', token: 'runtime-secret', timeoutMs: 5000 },
    (async (url, init) => {
      assert.equal(String(url), 'http://prism-gateway.internal:3040/credential-bundles/lease');
      observedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        env: { PLAUSIBLE_API_KEY: 'secret', PLAUSIBLE_BASE_URL: 'https://analytics.example.org' },
        leasedCredentials: ['plausible'],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  );
  const lease = await client.leaseCredentials({ credentials: ['plausible.stats'], context: { runtimeJobId: 'job-2' } });
  assert.deepEqual(observedBody, { credentials: ['plausible.stats'], context: { runtimeJobId: 'job-2' } });
  assert.deepEqual(lease, {
    env: { PLAUSIBLE_API_KEY: 'secret', PLAUSIBLE_BASE_URL: 'https://analytics.example.org' },
  });
});

test('gateway client preserves credential lease validation failures', async () => {
  const client = new PrismGatewayClient(
    {
      enabled: true,
      baseUrl: 'http://gateway.internal',
      token: 'runtime-token',
      timeoutMs: 1000,
    },
    async () => new Response(JSON.stringify({
      ok: false,
      traceId: 'trace-lease-invalid',
      error: {
        code: 'CREDENTIAL_LEASE_KEYS_INVALID',
        retryable: false,
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } }),
  );

  await assert.rejects(
    client.leaseCredentials({ credentials: ['one'] }),
    (error: unknown) => error instanceof GatewayClientError
      && error.code === 'CREDENTIAL_LEASE_KEYS_INVALID'
      && error.traceId === 'trace-lease-invalid',
  );
});

test('gateway client rejects leased runtime bootstrap variables', async () => {
  const client = new PrismGatewayClient(
    { enabled: true, baseUrl: 'http://prism-gateway.internal:3040', token: 'runtime-secret', timeoutMs: 5000 },
    (async () => new Response(JSON.stringify({
      ok: true,
      env: { NODE_OPTIONS: '--require=/tmp/untrusted.js' },
      leasedCredentials: ['unsafe'],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
  );

  await assert.rejects(
    client.leaseCredentials({ credentials: ['unsafe'] }),
    (error: unknown) => error instanceof GatewayClientError && error.code === 'PRISM_GATEWAY_LEASE_INVALID',
  );
});
