import type Database from 'better-sqlite3';
import { loadConfig } from './config';
import { getDb } from './db';

export const prismRuntimeContractVersion = '2026-07-10' as const;

export interface RuntimeProfileRecord {
  key: string;
  name: string;
  adapter: string;
  baseUrl: string;
  enabled: boolean;
  isDefault: boolean;
  contractVersion: string | null;
  features: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeProfileInput {
  key: string;
  name?: string | null;
  adapter: string;
  baseUrl: string;
  enabled?: boolean;
  isDefault?: boolean;
  contractVersion?: string | null;
  features?: string[];
}

type RuntimeProfileRow = {
  key: string;
  name: string;
  adapter: string;
  base_url: string;
  enabled: number;
  is_default: number;
  contract_version: string | null;
  features_json: string;
  created_at: string;
  updated_at: string;
};

const runtimeKeyPattern = /^[a-z][a-z0-9_.-]{1,79}$/;
const adapterPattern = /^[a-z][a-z0-9_.-]{1,79}$/;

function normalizeKey(value: unknown) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!runtimeKeyPattern.test(key)) throw new Error('RUNTIME_PROFILE_KEY_INVALID');
  return key;
}

function normalizeAdapter(value: unknown) {
  const adapter = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!adapterPattern.test(adapter)) throw new Error('RUNTIME_PROFILE_ADAPTER_INVALID');
  return adapter;
}

function normalizeBaseUrl(value: unknown) {
  const raw = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('RUNTIME_PROFILE_BASE_URL_INVALID');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new Error('RUNTIME_PROFILE_BASE_URL_INVALID');
  }
  return raw;
}

function normalizeFeatures(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => /^[a-z][a-z0-9-]{1,79}$/.test(entry))))
    .sort();
}

function mapRow(row: RuntimeProfileRow): RuntimeProfileRecord {
  let features: unknown = [];
  try {
    features = JSON.parse(row.features_json);
  } catch {
    features = [];
  }
  return {
    key: row.key,
    name: row.name,
    adapter: row.adapter,
    baseUrl: row.base_url,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    contractVersion: row.contract_version,
    features: normalizeFeatures(features),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowByKey(key: string, db: Database.Database = getDb()) {
  return db.prepare('SELECT * FROM runtime_profiles WHERE key = ?').get(key) as RuntimeProfileRow | undefined;
}

export function listRuntimeProfiles(db: Database.Database = getDb()) {
  ensureBootstrapRuntimeProfile(db);
  return (db.prepare(
    'SELECT * FROM runtime_profiles ORDER BY is_default DESC, enabled DESC, name, key',
  ).all() as RuntimeProfileRow[]).map(mapRow);
}

export function getRuntimeProfile(key: string, db: Database.Database = getDb()) {
  ensureBootstrapRuntimeProfile(db);
  const row = rowByKey(normalizeKey(key), db);
  return row ? mapRow(row) : null;
}

export function upsertRuntimeProfile(input: UpsertRuntimeProfileInput, db: Database.Database = getDb()) {
  const key = normalizeKey(input.key);
  const adapter = normalizeAdapter(input.adapter);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const existing = rowByKey(key, db);
  const now = new Date().toISOString();
  const enabled = input.enabled ?? true;
  const profileCount = Number((db.prepare('SELECT COUNT(*) AS count FROM runtime_profiles').get() as { count: number }).count);
  const isDefault = enabled && (input.isDefault ?? (existing?.is_default === 1 || profileCount === 0));
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : key;
  const contractVersion = typeof input.contractVersion === 'string' && input.contractVersion.trim()
    ? input.contractVersion.trim().slice(0, 80)
    : null;
  const features = normalizeFeatures(input.features);

  db.transaction(() => {
    if (isDefault) db.prepare('UPDATE runtime_profiles SET is_default = 0 WHERE is_default = 1').run();
    db.prepare(`
      INSERT INTO runtime_profiles (
        key, name, adapter, base_url, enabled, is_default, contract_version,
        features_json, created_at, updated_at
      ) VALUES (
        @key, @name, @adapter, @baseUrl, @enabled, @isDefault, @contractVersion,
        @featuresJson, @createdAt, @updatedAt
      )
      ON CONFLICT(key) DO UPDATE SET
        name = excluded.name,
        adapter = excluded.adapter,
        base_url = excluded.base_url,
        enabled = excluded.enabled,
        is_default = excluded.is_default,
        contract_version = excluded.contract_version,
        features_json = excluded.features_json,
        updated_at = excluded.updated_at
    `).run({
      key,
      name,
      adapter,
      baseUrl,
      enabled: enabled ? 1 : 0,
      isDefault: isDefault ? 1 : 0,
      contractVersion,
      featuresJson: JSON.stringify(features),
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    });
    const defaultCount = Number((db.prepare(
      'SELECT COUNT(*) AS count FROM runtime_profiles WHERE is_default = 1',
    ).get() as { count: number }).count);
    if (defaultCount === 0) {
      db.prepare(`
        UPDATE runtime_profiles SET is_default = 1, updated_at = @updatedAt
        WHERE key = (
          SELECT key FROM runtime_profiles WHERE enabled = 1 ORDER BY created_at, key LIMIT 1
        )
      `).run({ updatedAt: now });
    }
  })();

  return mapRow(rowByKey(key, db)!);
}

export function deleteRuntimeProfile(key: string, db: Database.Database = getDb()) {
  const normalized = normalizeKey(key);
  const existing = rowByKey(normalized, db);
  if (!existing) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM runtime_profiles WHERE key = ?').run(normalized);
    if (existing.is_default === 1) {
      db.prepare(`
        UPDATE runtime_profiles SET is_default = 1, updated_at = ?
        WHERE key = (
          SELECT key FROM runtime_profiles WHERE enabled = 1 ORDER BY created_at, key LIMIT 1
        )
      `).run(new Date().toISOString());
    }
  })();
  return true;
}

export function ensureBootstrapRuntimeProfile(db: Database.Database = getDb()) {
  const count = Number((db.prepare('SELECT COUNT(*) AS count FROM runtime_profiles').get() as { count: number }).count);
  if (count > 0) return;
  const baseUrl = loadConfig().codexRuntimeBaseUrl;
  if (!baseUrl) return;
  upsertRuntimeProfile({
    key: 'codex-default',
    name: 'Codex Default',
    adapter: 'codex-cli',
    baseUrl,
    enabled: true,
    isDefault: true,
    contractVersion: prismRuntimeContractVersion,
  }, db);
}

export function resolveRuntimeProfile(requestedKey?: string | null, db: Database.Database = getDb()) {
  ensureBootstrapRuntimeProfile(db);
  if (requestedKey?.trim()) {
    const row = rowByKey(normalizeKey(requestedKey), db);
    if (!row) throw new Error('RUNTIME_PROFILE_NOT_FOUND');
    if (row.enabled !== 1) throw new Error('RUNTIME_PROFILE_DISABLED');
    return mapRow(row);
  }
  const row = db.prepare(`
    SELECT * FROM runtime_profiles
    WHERE enabled = 1
    ORDER BY is_default DESC, created_at, key
    LIMIT 1
  `).get() as RuntimeProfileRow | undefined;
  if (!row) throw new Error('CODEX_RUNTIME_BASE_URL_MISSING');
  return mapRow(row);
}
