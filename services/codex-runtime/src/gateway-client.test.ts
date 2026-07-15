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

test('gateway client preserves toolset failure trace IDs for audit correlation', async () => {
  const client = new PrismGatewayClient(
    {
      enabled: true,
      baseUrl: 'http://prism-gateway.internal:3040',
      token: 'runtime-secret',
      timeoutMs: 5000,
    },
    (async () => new Response(JSON.stringify({
      ok: false,
      traceId: 'trace-portal-timeout',
      error: {
        code: 'TOOLSET_DOWNSTREAM_TIMEOUT',
        retryable: true,
      },
    }), { status: 502, headers: { 'content-type': 'application/json' } })) as typeof fetch,
  );

  await assert.rejects(
    client.toolsetRequest({
      toolset: 'portal.admin',
      action: 'request',
      request: { method: 'POST', path: '/api/wiki/topics/expansion/import' },
    }),
    (error: unknown) => error instanceof GatewayClientError
      && error.code === 'TOOLSET_DOWNSTREAM_TIMEOUT'
      && error.traceId === 'trace-portal-timeout'
      && error.retryable,
  );
});

test('gateway client distinguishes timeouts from unreachable Gateway failures', async () => {
  const config = {
    enabled: true,
    baseUrl: 'http://prism-gateway.internal:3040',
    token: 'runtime-secret',
    timeoutMs: 5000,
  };
  const timeout = new PrismGatewayClient(config, (async () => {
    throw new DOMException('request timed out', 'TimeoutError');
  }) as typeof fetch);
  const unreachable = new PrismGatewayClient(config, (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch);

  await assert.rejects(
    timeout.toolsetRequest({ toolset: 'portal.admin', action: 'describe' }),
    (error: unknown) => error instanceof GatewayClientError
      && error.code === 'PRISM_GATEWAY_TIMEOUT'
      && error.status === 504
      && error.retryable,
  );
  await assert.rejects(
    unreachable.toolsetRequest({ toolset: 'portal.admin', action: 'describe' }),
    (error: unknown) => error instanceof GatewayClientError
      && error.code === 'PRISM_GATEWAY_UNREACHABLE'
      && error.status === 502
      && error.retryable,
  );
});

test('gateway client allows a slow relay to complete before its configured deadline', async () => {
  const client = new PrismGatewayClient(
    {
      enabled: true,
      baseUrl: 'http://prism-gateway.internal:3040',
      token: 'runtime-secret',
      timeoutMs: 100,
    },
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response(JSON.stringify({
        ok: true,
        traceId: 'trace-slow-success',
        toolset: 'portal.admin',
        downstreamStatus: 200,
        result: { imported: 11 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  );

  const result = await client.toolsetRequest({
    toolset: 'portal.admin',
    action: 'request',
    request: { method: 'POST', path: '/api/wiki/topics/expansion/import' },
  });
  assert.equal(result.traceId, 'trace-slow-success');
  assert.deepEqual(result.result, { imported: 11 });
});

test('gateway client aborts a relay that exceeds its configured deadline', async () => {
  let attempts = 0;
  const client = new PrismGatewayClient(
    {
      enabled: true,
      baseUrl: 'http://prism-gateway.internal:3040',
      token: 'runtime-secret',
      timeoutMs: 10,
    },
    (async (_url, init) => new Promise<Response>((_resolve, reject) => {
      attempts += 1;
      const signal = init?.signal;
      if (!signal) return reject(new Error('missing abort signal'));
      const keepAlive = setTimeout(() => reject(new Error('deadline signal did not abort')), 100);
      const abort = () => {
        clearTimeout(keepAlive);
        reject(signal.reason);
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    })) as typeof fetch,
  );

  await assert.rejects(
    client.toolsetRequest({
      toolset: 'portal.admin',
      action: 'request',
      request: { method: 'POST', path: '/api/wiki/topics/expansion/import' },
    }),
    (error: unknown) => error instanceof GatewayClientError
      && error.code === 'PRISM_GATEWAY_TIMEOUT'
      && error.status === 504,
  );
  assert.equal(attempts, 1);
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

test('gateway client leases adapter credentials without changing their names', async () => {
  let observedBody: Record<string, unknown> = {};
  const client = new PrismGatewayClient(
    { enabled: true, baseUrl: 'http://prism-gateway.internal:3040', token: 'runtime-secret', timeoutMs: 5000 },
    (async (url, init) => {
      assert.equal(String(url), 'http://prism-gateway.internal:3040/toolsets/lease');
      observedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        env: { AWS_ACCESS_KEY_ID: 'leased-access', AWS_SECRET_ACCESS_KEY: 'leased-secret' },
        leasedToolsets: ['storage.s3'],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  );
  const lease = await client.leaseToolsets({ toolsets: ['storage.s3'], context: { runtimeJobId: 'job-1' } });
  assert.deepEqual(observedBody, { toolsets: ['storage.s3'], context: { runtimeJobId: 'job-1' } });
  assert.deepEqual(lease, {
    env: { AWS_ACCESS_KEY_ID: 'leased-access', AWS_SECRET_ACCESS_KEY: 'leased-secret' },
    leasedToolsets: ['storage.s3'],
  });
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
        environmentOnlyAliases: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  );
  const lease = await client.leaseCredentials({ credentials: ['plausible.stats'], context: { runtimeJobId: 'job-2' } });
  assert.deepEqual(observedBody, { credentials: ['plausible.stats'], context: { runtimeJobId: 'job-2' } });
  assert.deepEqual(lease, {
    env: { PLAUSIBLE_API_KEY: 'secret', PLAUSIBLE_BASE_URL: 'https://analytics.example.org' },
    environmentOnlyAliases: [],
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
      environmentOnlyAliases: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
  );

  await assert.rejects(
    client.leaseCredentials({ credentials: ['unsafe'] }),
    (error: unknown) => error instanceof GatewayClientError && error.code === 'PRISM_GATEWAY_LEASE_INVALID',
  );
});
