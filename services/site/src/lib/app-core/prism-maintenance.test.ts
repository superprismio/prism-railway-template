import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { prismMaintenanceMigration, prismMaintenanceWorkflow } from './migrations/051_prism_maintenance';
import { maintenanceRequestRecoverySkillMigration } from './migrations/054_maintenance_request_recovery_skill';
import { maintenanceSupersessionSkillMigration } from './migrations/055_maintenance_supersession_skill';
import { migrations } from './migrations';

test('full migration chain assigns seeded maintenance to Dreamer', () => {
  const db = new Database(':memory:');
  try {
    for (const migration of migrations) db.exec(migration.sql);
    const workflow = db.prepare("SELECT definition_json FROM workflows WHERE key = 'prism-maintenance'").get() as { definition_json: string };
    assert.equal(JSON.parse(workflow.definition_json).defaultAgent, 'dreamer-agent');
    assert.ok(db.prepare("SELECT id FROM agent_profiles WHERE key = 'dreamer-agent' AND status = 'active'").get());
  } finally { db.close(); }
});

test('maintenance keeps full evidence while suppressing clean and already-reported no-ops', () => {
  const instructions = readFileSync(new URL('../../../workflows/prism-maintenance/steps/verify.md', import.meta.url), 'utf8');
  assert.match(instructions, /Quiet no-op notification policy \(takes precedence/);
  assert.match(instructions, /Always save the complete maintenance report/);
  assert.match(instructions, /unchanged-already-reported/);
  assert.match(instructions, /Never suppress a failed or\s+uncertain delivery retry/);
  assert.match(instructions, /provider-accepted message IDs/);
});

test('maintenance workflow is targetless, explicitly owned and has valid transitions', () => {
  const w = prismMaintenanceWorkflow;
  assert.equal(w.target.required, false);
  assert.equal(w.defaultAgent, 'admin-agent');
  assert.ok(w.steps[1].agentConfig?.skills?.includes('change-request-ops'));
  const keys = new Set(w.steps.map(step => step.key));
  for (const step of w.steps) {
    assert.notEqual(step.type, 'gate');
    if (step.type !== 'terminal') assert.ok(keys.has(step.next!));
  }
});

test('existing seeded maintenance gains request recovery skill without overwriting custom skills', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE workflows(id TEXT PRIMARY KEY,key TEXT UNIQUE,name TEXT,description TEXT,version INTEGER,definition_json TEXT,system_default INTEGER,enabled INTEGER,created_at TEXT,updated_at TEXT);`);
    const old = structuredClone(prismMaintenanceWorkflow);
    old.steps[1].agentConfig!.skills = ['prism-workflow-author', 'prism-skill-author', 'prism-gateway-author'];
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?,?)').run('id', old.key, old.name, old.description, 1, JSON.stringify(old), 1, 1, '', '');
    db.exec(maintenanceRequestRecoverySkillMigration.sql);
    const current = JSON.parse((db.prepare('SELECT definition_json FROM workflows').get() as { definition_json: string }).definition_json);
    assert.ok(current.steps[1].agentConfig.skills.includes('change-request-ops'));
    const custom = ['custom-request-skill'];
    current.steps[1].agentConfig.skills = custom;
    db.prepare('UPDATE workflows SET definition_json=?').run(JSON.stringify(current));
    db.exec(maintenanceRequestRecoverySkillMigration.sql);
    const preserved = JSON.parse((db.prepare('SELECT definition_json FROM workflows').get() as { definition_json: string }).definition_json);
    assert.deepEqual(preserved.steps[1].agentConfig.skills, custom);
  } finally { db.close(); }
});

test('supersession migration adds request operations to seeded assessment and verification only', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE workflows(id TEXT PRIMARY KEY,key TEXT UNIQUE,name TEXT,description TEXT,version INTEGER,definition_json TEXT,system_default INTEGER,enabled INTEGER,created_at TEXT,updated_at TEXT);`);
    const old = structuredClone(prismMaintenanceWorkflow);
    old.steps[0].agentConfig!.skills = ['prism-doctor'];
    old.steps[2].agentConfig!.skills = ['prism-doctor'];
    db.prepare('INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?,?)').run('id', old.key, old.name, old.description, 1, JSON.stringify(old), 1, 1, '', '');
    db.exec(maintenanceSupersessionSkillMigration.sql);
    const updated = db.prepare('SELECT version,definition_json FROM workflows').get() as { version: number; definition_json: string };
    const definition = JSON.parse(updated.definition_json);
    assert.equal(updated.version, 2);
    assert.equal(definition.version, 2);
    assert.deepEqual(definition.steps[0].agentConfig.skills, ['prism-doctor', 'change-request-ops']);
    assert.deepEqual(definition.steps[2].agentConfig.skills, ['prism-doctor', 'change-request-ops']);
    db.exec(maintenanceSupersessionSkillMigration.sql);
    assert.equal((db.prepare('SELECT version FROM workflows').pluck().get()), 2);
  } finally { db.close(); }
});

test('maintenance seed is idempotent and preserves an existing custom definition', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE workflows(id TEXT PRIMARY KEY,key TEXT UNIQUE,name TEXT,description TEXT,version INTEGER,definition_json TEXT,system_default INTEGER,enabled INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE accountability_domain_assignments(target_type TEXT,target_id TEXT,domain_id TEXT,created_at TEXT,updated_at TEXT,UNIQUE(target_type,target_id));`);
    db.exec(prismMaintenanceMigration.sql);
    db.exec(prismMaintenanceMigration.sql);
    assert.equal((db.prepare('SELECT count(*) n FROM workflows').get() as {n:number}).n, 1);
    db.prepare('UPDATE workflows SET definition_json = ?').run('{"custom":true}');
    db.exec(prismMaintenanceMigration.sql);
    assert.equal((db.prepare('SELECT definition_json FROM workflows').get() as {definition_json:string}).definition_json, '{"custom":true}');
  } finally { db.close(); }
});
