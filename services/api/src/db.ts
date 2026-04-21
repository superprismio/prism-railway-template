import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from './config.js';
import { migrations } from './migrations/index.js';

let dbInstance: Database.Database | null = null;

function ensureMigrationTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function createDatabase(): Database.Database {
  const config = loadConfig();
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  ensureMigrationTable(db);
  return db;
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = createDatabase();
  }

  return dbInstance;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function runMigrations(db = getDb()) {
  ensureMigrationTable(db);

  const appliedRows = db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>;
  const appliedNames = new Set(appliedRows.map((row) => row.name));
  const insertApplied = db.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (@name, @appliedAt)',
  );

  const executed: string[] = [];

  for (const migration of migrations) {
    if (appliedNames.has(migration.name)) {
      continue;
    }

    const appliedAt = new Date().toISOString();
    const transaction = db.transaction(() => {
      db.exec(migration.sql);
      insertApplied.run({ name: migration.name, appliedAt });
    });

    transaction();
    executed.push(migration.name);
  }

  return {
    executed,
    totalKnown: migrations.length,
  };
}