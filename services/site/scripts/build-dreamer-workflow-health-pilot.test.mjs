import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('pilot routes findings through verification under Dreamer before reporting', () => {
  const payload = JSON.parse(execFileSync(process.execPath, [
    new URL('./build-dreamer-workflow-health-pilot.mjs', import.meta.url).pathname,
    '--revision-id=reviewed-revision', '--checksum=sha256:reviewed', '--workflow-keys=one,two',
    '--scope-key=health-canary', '--dreamer-profile=dreamer-agent', '--accountability-domain=prism-builtins',
  ], { encoding: 'utf8' }));
  assert.equal(payload.enabled, false);
  const [inspect, assess, report] = payload.manifest.steps;
  assert.equal(inspect.next, 'assess-findings');
  assert.equal(inspect.scriptConfig.fallbackStepKey, 'assess-findings');
  assert.equal(inspect.scriptConfig.noOpNextStepKey, 'closed');
  assert.equal(assess.executorAgent, 'dreamer-agent');
  assert.ok(assess.agentConfig.skills.includes('change-request-ops'));
  assert.equal(report.executorAgent, 'dreamer-agent');
  assert.ok(report.agentConfig.skills.includes('discord-send'));
  assert.match(payload.files['steps/assess-findings.md'], /\/agent\/change-board\/requests\/by-number\/.*\/artifacts\?name=/);
  assert.match(payload.files['steps/report-results.md'], /corrected dispositions/);
  assert.match(payload.files['steps/assess-findings.md'], /Copy the inspector's raw fingerprint verbatim/);
  assert.match(payload.files['steps/report-results.md'], /Use this same raw fingerprint in the delivery record/);
  const reporting = payload.files['steps/report-results.md'];
  assert.ok(reporting.indexOf('Check eligibility BEFORE delivery deduplication') < reporting.indexOf('GET /agent/workflow-health/deliveries'));
  assert.match(reporting, /exact human action is necessary/);
  assert.match(reporting, /suppressed_no_human_action/);
  assert.match(reporting, /lack of repair authority is NOT a reason to alert/);
  assert.match(reporting, /Parse the exact body before upload and read back and parse/);
  assert.doesNotMatch(reporting, /a short recap alone is insufficient|For meaningful change,|Send an introduction and the entire/);
  assert.match(reporting, /must not be recorded as delivered/);
  assert.match(reporting, /alertIdentity, recoveryResult and exactHumanAction/);
  assert.match(reporting, /response's requestId to fetch GET \/agent\/change-board\/requests\/:id\/artifacts/);
});
