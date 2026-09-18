import test from 'node:test';
import assert from 'node:assert/strict';
import { runFailureDetails } from './run-failure';

test('unwraps and deduplicates Gateway failures', () => {
  const result = runFailureDetails(JSON.stringify({error:'RUNTIME_REQUEST_FAILED:CREDENTIAL_LEASE_ENV_PROTECTED:CREDENTIAL_LEASE_ENV_PROTECTED'}))!;
  assert.equal(result.detail,'RUNTIME_REQUEST_FAILED:CREDENTIAL_LEASE_ENV_PROTECTED');
  assert.equal(result.label,'Credential loading failed');
});
test('interruptions preserve uncertainty about prior side effects', () => {
  const result = runFailureDetails('RUNTIME_JOB_POLL_FAILED:404:RUNTIME_JOB_NOT_FOUND')!;
  assert.equal(result.label,'Run interrupted or timed out');
  assert.match(result.recovery,/completed actions/);
  assert.equal(runFailureDetails(null),null);
});
