import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { listWorkflowEventFeed } from './workflow-event-feed';

function testDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workflow_events (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      step_key TEXT,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      note TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(
    `INSERT INTO workflow_events VALUES (?, 'run-1', 'request-1', NULL, ?, 'system', NULL, NULL, ?, ?)`,
  );
  insert.run('event-a', 'agent.completed', '{"sequence":1}', '2026-07-15T12:00:00.000Z');
  insert.run('event-b', 'agent.blocked', '{"sequence":2}', '2026-07-15T12:00:00.000Z');
  insert.run('event-c', 'external_ref.upserted', '{"sequence":3}', '2026-07-15T12:01:00.000Z');
  return db;
}

test('workflow event feed pages chronologically with a stable tie-break cursor', () => {
  const db = testDb();
  const first = listWorkflowEventFeed({ limit: 1 }, db);
  const second = listWorkflowEventFeed({ cursor: first.nextCursor, limit: 1 }, db);

  assert.deepEqual(first.events.map((event) => event.id), ['event-a']);
  assert.equal(first.hasMore, true);
  assert.deepEqual(second.events.map((event) => event.id), ['event-b']);
  assert.deepEqual(second.events[0].payload, { sequence: 2 });
  db.close();
});

test('workflow event feed filters operator-selected event types', () => {
  const db = testDb();
  const page = listWorkflowEventFeed({
    eventTypes: ['agent.blocked', 'external_ref.upserted'],
    limit: 10,
  }, db);

  assert.deepEqual(page.events.map((event) => event.id), ['event-b', 'event-c']);
  assert.equal(page.hasMore, false);
  db.close();
});

test('workflow event feed rejects malformed cursors', () => {
  const db = testDb();
  assert.throws(() => listWorkflowEventFeed({ cursor: 'not-a-cursor' }, db), /WORKFLOW_EVENT_CURSOR_INVALID/);
  db.close();
});
