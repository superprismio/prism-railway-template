import test from 'node:test';
import assert from 'node:assert/strict';
import { ScriptFailure, redactDiagnostic } from './script-failure.js';

test('script failure retains structured stdout error when stderr is empty', () => {
  const error = new ScriptFailure({ scriptKey: 'watcher', exitCode: 1,
    stdout: JSON.stringify({error: {code: 'HTTP_FAILED', message: 'GET https://example.com/api?token=hidden returned 503'}}), stderr: '' });
  assert.match(error.message, /HTTP_FAILED/);
  assert.match(error.message, /503/);
  assert.doesNotMatch(error.message, /hidden/);
  assert.equal(error.diagnostics.exitCode, 1);
});
test('failure diagnostics redact leased values, auth and URLs before bounding', () => {
  const error = new ScriptFailure({scriptKey:'test',exitCode:null,signal:'SIGTERM',timedOut:true,
    stdout:'not json',stderr:'Bearer abc password=def leased-secret '+ 'x'.repeat(3000),secrets:['leased-secret']});
  assert.doesNotMatch(error.message, /abc|def|leased-secret/);
  assert.equal(error.diagnostics.timedOut,true);
  assert.equal(error.diagnostics.outputTruncated,true);
  assert.ok(String(error.diagnostics.stderr).length <= 2000);
  assert.equal(redactDiagnostic('https://user:pass@example.com/a?secret=value'), 'https://[redacted]@example.com/a?[redacted]');
});
test('empty errors say so and do not persist arbitrary stdout', () => {
  const error = new ScriptFailure({scriptKey:'test',exitCode:1,stdout:'private result',stderr:''});
  assert.match(error.message,/No error details emitted/);
  assert.doesNotMatch(JSON.stringify(error.diagnostics),/private result/);
});
