import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeRuntimeCreatorMint } from './source-adapter-runtime-auth';

test('shared service caller cannot mint another profile creator via runtime metadata', () => {
  const forged = { sourceSessionId: 'other-profile-session', sourceMessageId: 'other-message' };
  const policy = { expected: 'dedicated-adapter-secret', serviceToken: 'shared-service-secret',
    adapterToken: 'communication-api-secret', requestOrigin: forged };
  assert.deepEqual(authorizeRuntimeCreatorMint({ ...policy, presented: null }), {
    allowed: false, error: 'SOURCE_ADAPTER_RUNTIME_TOKEN_REQUIRED',
  });
  assert.equal(authorizeRuntimeCreatorMint({ ...policy, presented: 'shared-service-secret' }).allowed, false);
  assert.equal(authorizeRuntimeCreatorMint({ ...policy, presented: 'communication-api-secret' }).allowed, false);
  assert.deepEqual(authorizeRuntimeCreatorMint({ ...policy, requestOrigin: null, presented: 'shared-service-secret' }), {
    allowed: false, error: null,
  });
  assert.deepEqual(authorizeRuntimeCreatorMint({ ...policy, presented: 'dedicated-adapter-secret' }), {
    allowed: true, error: null,
  });
  assert.equal(authorizeRuntimeCreatorMint({ ...policy, expected: 'shared-service-secret', presented: 'shared-service-secret' }).allowed, false);
});
