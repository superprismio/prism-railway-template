import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('lease boundary never expands Site credential authority with selected skill metadata', () => {
  const source = readFileSync(new URL('../src/codex-runtime.ts', import.meta.url), 'utf8');
  const boundary = source.slice(source.indexOf('const effectiveCredentials ='), source.indexOf('const leasedEnv ='));
  assert.match(boundary, /new Set\(input.credentials \?\? \[\]\)/);
  assert.doesNotMatch(boundary, /requiredCredentials|selectedSkills/);
  assert.match(boundary, /read_only_utility' \? \[\] : effectiveCredentials/);
  assert.match(boundary, /credentials: credentialLeaseKeys/);
});
