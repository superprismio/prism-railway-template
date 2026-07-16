import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runtimeProfilesMigration } from './migrations/031_runtime_profiles';
import { externalInteractionsMigration } from './migrations/034_external_interactions';
import { upsertRuntimeProfile } from './runtime-profiles';
import {
  authorizeExternalInterface,
  deleteInteractionProfile,
  listInteractionAccessEvents,
  rotateExternalInterfaceCredential,
  upsertExternalInterface,
  upsertInteractionProfile,
} from './external-interactions';

function testDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(runtimeProfilesMigration.sql);
  db.exec(externalInteractionsMigration.sql);
  upsertRuntimeProfile({
    key: 'public-chat',
    adapter: 'test-runtime',
    baseUrl: 'http://runtime.internal',
  }, db);
  return db;
}

test('external interfaces are disabled and credential-free by default', () => {
  const db = testDb();
  const profile = upsertInteractionProfile({
    key: 'docs-guide',
    mode: 'readonly',
    runtimeProfileKey: 'public-chat',
    persona: { name: 'Docs Guide', instructions: 'Use approved documentation.' },
  }, db);
  assert.equal(profile.version, 1);
  const externalInterface = upsertExternalInterface({
    key: 'docs-assistant',
    interactionProfileKey: profile.key,
  }, db);
  assert.equal(externalInterface.enabled, false);
  assert.equal(externalInterface.credential.configured, false);
  assert.deepEqual(
    authorizeExternalInterface({ key: externalInterface.key, credential: 'missing' }, db),
    { ok: false, code: 'EXTERNAL_INTERFACE_DISABLED' },
  );
  db.close();
});

test('credential authorization returns only resolved non-secret configuration', () => {
  const db = testDb();
  upsertInteractionProfile({
    key: 'project-member',
    mode: 'run-approved',
    runtimeProfileKey: 'public-chat',
    allowedWorkflows: ['project-intake'],
    rateLimit: { windowSeconds: 30, maxRequests: 4 },
  }, db);
  upsertExternalInterface({
    key: 'portal-projects',
    interactionProfileKey: 'project-member',
    allowedOrigins: ['https://portal.example.org'],
  }, db);
  const rotated = rotateExternalInterfaceCredential('portal-projects', db);
  upsertExternalInterface({
    key: 'portal-projects',
    interactionProfileKey: 'project-member',
    enabled: true,
    allowedOrigins: ['https://portal.example.org'],
  }, db);
  assert.match(rotated.credential, /^prism_int_/);
  assert.equal(JSON.stringify(rotated.interface).includes(rotated.credential), false);

  assert.equal(authorizeExternalInterface({
    key: 'portal-projects',
    credential: rotated.credential,
    origin: 'https://evil.example.org',
  }, db).code, 'EXTERNAL_INTERFACE_ORIGIN_DENIED');
  const authorized = authorizeExternalInterface({
    key: 'portal-projects',
    credential: rotated.credential,
    origin: 'https://portal.example.org',
    requestId: 'request-1',
    subject: 'portal:user:123',
  }, db);
  assert.equal(authorized.ok, true);
  if (authorized.ok) {
    assert.equal(authorized.resolved.profile.mode, 'run-approved');
    assert.deepEqual(authorized.resolved.profile.allowedWorkflows, ['project-intake']);
    assert.equal(authorized.resolved.interface.credential.prefix, rotated.credential.slice(0, 18));
  }
  const events = listInteractionAccessEvents('portal-projects', 10, db);
  assert.equal(events[0]?.outcome, 'accepted');
  assert.equal(events.some((event) => event.reason === 'origin-denied'), true);
  assert.equal(events.some((event) => JSON.stringify(event).includes(rotated.credential)), false);
  db.close();
});

test('full interfaces cannot be enabled and referenced profiles cannot be deleted', () => {
  const db = testDb();
  upsertInteractionProfile({ key: 'trusted', mode: 'full' }, db);
  assert.throws(() => upsertExternalInterface({
    key: 'trusted-api',
    interactionProfileKey: 'trusted',
    enabled: true,
  }, db), /EXTERNAL_INTERFACE_FULL_MODE_NOT_SUPPORTED/);

  upsertInteractionProfile({ key: 'limited', mode: 'readonly' }, db);
  upsertExternalInterface({ key: 'limited-api', interactionProfileKey: 'limited' }, db);
  assert.throws(() => deleteInteractionProfile('limited', db), /INTERACTION_PROFILE_IN_USE/);
  db.close();
});
