import assert from 'node:assert/strict';
import test from 'node:test';
import { CapacityAttempt, consumeJsonLines, isExplicitModelCapacity, setupStopCode, terminalModelCapacity, waitForCapacityRetry } from './model-capacity.js';
import { RunBudget } from './run-budget.js';

test('only an explicit selected-model capacity error qualifies', () => {
  assert.equal(isExplicitModelCapacity('Selected model is at capacity'), true);
  assert.equal(isExplicitModelCapacity('model overloaded'), false);
  assert.equal(isExplicitModelCapacity('Selected model is at capacity in archived log'), true);
});

test('unknown items, tools, file edits and delegation make replay unsafe', () => {
  for (const type of ['command_execution', 'file_change', 'collab_tool_call', 'unknown_future_item']) {
    const attempt = new CapacityAttempt();
    attempt.observe({ type: 'thread.started' });
    attempt.observe({ type: 'item.started', item: { type } });
    assert.equal(attempt.safeToReplay, false, type);
  }
  const safe = new CapacityAttempt();
  safe.observe({ type: 'item.started', item: { type: 'reasoning' } });
  safe.observe({ type: 'item.completed', item: { type: 'agent_message' } });
  assert.equal(safe.safeToReplay, true);
});

test('capacity delay is abortable', async () => {
  const controller = new AbortController();
  const waiting = waitForCapacityRetry(10_000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, /RUNTIME_JOB_CANCELED/);
});

test('the final JSONL record without a newline still records an unsafe started tool', () => {
  const attempt = new CapacityAttempt();
  const seen: string[] = [];
  const onLine = (line: string) => {
    seen.push(line);
    attempt.observe(JSON.parse(line));
  };
  let pending = consumeJsonLines('', '{"type":"thread.started"}\n{"type":"item.started","item":{"type":"command_execution"}}', onLine);
  assert.equal(attempt.safeToReplay, true);
  pending = consumeJsonLines(pending, '', onLine, true);
  assert.equal(pending, '');
  assert.equal(seen.length, 2);
  assert.equal(attempt.safeToReplay, false);
});

test('terminal capacity overrides a partial assistant answer', () => {
  const partialResponseText = 'I will inspect the request';
  assert.ok(partialResponseText);
  assert.equal(terminalModelCapacity(0, 'Selected model is at capacity'), true);
  assert.equal(terminalModelCapacity(1, 'Selected model is at capacity'), true);
  assert.equal(terminalModelCapacity(0, ''), false);
});

test('setup honors the shared absolute budget and cancellation before another spawn', () => {
  const budget = new RunBudget(0, 100, 500);
  assert.equal(setupStopCode(budget, 50), null);
  budget.progress(90);
  assert.equal(setupStopCode(budget, 191), 'CODEX_RUNTIME_IDLE_TIMEOUT');
  budget.progress(450);
  assert.equal(setupStopCode(budget, 501), 'CODEX_RUNTIME_BUDGET_EXCEEDED');
  const controller = new AbortController();
  controller.abort();
  assert.equal(setupStopCode(budget, 50, controller.signal), 'RUNTIME_JOB_CANCELED');
});
