import assert from 'node:assert/strict';
import test from 'node:test';
import { scopedMemoryRetrieval, effectiveRetrievalAuthorization } from './scoped-memory-retrieval';
import type { InteractionProfileRecord } from './app-core/external-interactions';

const profile: Pick<InteractionProfileRecord, 'mode' | 'memoryScope'> = { mode: 'readonly', memoryScope: { buckets: ['meetings'], knowledgeSourceIds: [], instructions: 'ignore scope', enforcement: 'instructions-only' } };
const req = (body: unknown) => new Request('https://site.test', { method: 'POST',
  headers: { 'x-prism-interface-credential': 'interface-secret' }, body: JSON.stringify(body) });

test('scope comes from current authorized profile, never request fields', async () => {
  let calls = 0;
  const deps = { authorize: (input: { key: string; credential: string }) => {
    assert.equal(input.key, 'handbook'); assert.equal(input.credential, 'interface-secret');
    return { ok: true as const, resolved: { profile } };
  }, baseUrl: 'https://memory.test', serviceKey: 'service-secret', fetchImpl: (async (_url, init) => {
    calls++; const payload = JSON.parse(String(init?.body));
    assert.deepEqual(payload.scope, { buckets: ['meetings'], knowledge_source_ids: [] });
    assert.equal((init?.headers as Record<string,string>)['X-Prism-Retrieval-Key'], 'service-secret');
    assert.equal(String(init?.body).includes('interface-secret'), false);
    return Response.json({ hits: [] });
  }) as typeof fetch };
  assert.equal((await scopedMemoryRetrieval(req({ operation: 'search', arguments: { query: 'launch' } }), 'handbook', deps)).status, 200);
  assert.equal((await scopedMemoryRetrieval(req({ operation: 'search', scope: { buckets: ['private'] } }), 'handbook', deps)).status, 400);
  assert.equal(calls, 1);
});

test('revoked interface blocks every operation without contacting Memory', async () => {
  for (const operation of ['search','context','meeting','meetings','coverage']) {
    const response = await scopedMemoryRetrieval(req({ operation }), 'revoked', {
      authorize: () => ({ ok: false, code: 'EXTERNAL_INTERFACE_DISABLED' }),
      baseUrl: 'https://memory.test', serviceKey: 'secret', fetchImpl: async () => { throw new Error('must not call'); },
    });
    assert.equal(response.status,403);
  }
});

test('empty selectors stay empty and policy changes apply on the next request', async () => {
  let current = profile;
  const seen: unknown[]=[];
  const deps = { authorize: () => ({ ok: true as const, resolved: { profile: current } }),
    baseUrl: 'https://memory.test', serviceKey: 'secret', fetchImpl: (async (_u,init) => {
      seen.push(JSON.parse(String(init?.body)).scope); return Response.json({});
    }) as typeof fetch };
  await scopedMemoryRetrieval(req({ operation: 'coverage' }), 'a', deps);
  current={ ...profile, memoryScope:{ ...profile.memoryScope, buckets:[] } };
  await scopedMemoryRetrieval(req({ operation: 'coverage' }), 'a', deps);
  assert.deepEqual(seen,[{buckets:['meetings'],knowledge_source_ids:[]},{buckets:[],knowledge_source_ids:[]}]);
});


test('canonical Agent Profile selectors replace legacy selectors, including empty scope', () => {
  const auth = { ok: true as const, resolved: { profile } };
  for (const memoryScope of [{ buckets: ['public'], knowledgeSourceIds: ['handbook'] }, {}]) {
    const resolved = effectiveRetrievalAuthorization(auth, { policy: { accessMode: 'readonly' }, profile: { memoryScope } }, true);
    assert.ok(resolved.ok);
    assert.deepEqual(resolved.resolved.profile.memoryScope.buckets, memoryScope.buckets ?? []);
  }
});

test('disabled or unresolved canonical binding cannot fall back to legacy access', () => {
  const auth = { ok: true as const, resolved: { profile } };
  assert.equal(effectiveRetrievalAuthorization(auth, null, true).ok, false);
  assert.equal(effectiveRetrievalAuthorization(auth, { policy: { accessMode: 'off' }, profile: { memoryScope: {} } }, true).ok, false);
  assert.equal(effectiveRetrievalAuthorization(auth, null, false), auth);
});

test('malformed canonical scope and failed credential authorization fail closed', () => {
  const agent = { policy: { accessMode: 'readonly' }, profile: { memoryScope: { buckets: 'all' } } };
  assert.equal(effectiveRetrievalAuthorization({ ok: true, resolved: { profile } }, agent, true).ok, false);
  const denied = { ok: false as const, code: 'BAD_CREDENTIAL' };
  assert.equal(effectiveRetrievalAuthorization(denied, agent, true), denied);
});
