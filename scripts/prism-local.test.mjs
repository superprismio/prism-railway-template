import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('local Codex registration includes the verification capabilities advertised by runtime', () => {
  const script = readFileSync(new URL('./prism-local.mjs', import.meta.url), 'utf8');
  const profiles = script.slice(script.indexOf('const profiles = ['));
  const registration = profiles.slice(profiles.indexOf('key: "codex-default"'), profiles.indexOf('key: "grok-local"'));
  const features = JSON.parse(registration.match(/features: (\[[^\]]+\])/)[1]);
  for (const feature of ['repository', 'shell', 'browser-automation']) assert.ok(features.includes(feature));
});
