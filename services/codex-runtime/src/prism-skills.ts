import { gunzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { config } from './config.js';

type SkillRecord = {
  name: string;
  path: string;
  description: string;
  downloadPath?: string;
  source: 'prism-memory' | 'app-api';
};

type SkillIndexResponse = {
  skills?: Array<{
    name?: string;
    path?: string;
    description?: string | null;
    downloadPath?: string;
  }>;
};

type SkillCacheEntry = {
  content: string;
  fetchedAt: number;
};

let skillIndexCache: { skills: SkillRecord[]; fetchedAt: number } | null = null;
const skillContentCache = new Map<string, SkillCacheEntry>();

function hasValidCache(fetchedAt: number) {
  return Date.now() - fetchedAt < config.prismSkillCacheTtlMs;
}

async function prismRequest(path: string) {
  if (!config.prismApiBase || !config.prismApiKey) {
    throw new Error('PRISM_SKILLS_NOT_CONFIGURED');
  }

  const response = await fetch(`${config.prismApiBase}${path}`, {
    headers: {
      'X-Prism-Api-Key': config.prismApiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PRISM_REQUEST_FAILED:${response.status}:${path}:${text.slice(0, 200)}`);
  }

  return response;
}

async function appApiRequest(path: string) {
  if (!config.appApiBaseUrl || !config.appServiceToken) {
    throw new Error('APP_SKILLS_NOT_CONFIGURED');
  }

  const response = await fetch(`${config.appApiBaseUrl}${path}`, {
    headers: {
      'x-service-token': config.appServiceToken,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`APP_API_REQUEST_FAILED:${response.status}:${path}:${text.slice(0, 200)}`);
  }

  return response;
}

function normalizeSkillRecord(
  source: SkillRecord['source'],
  entry: { name?: string; path?: string; description?: string | null; downloadPath?: string },
): SkillRecord | null {
  if (typeof entry.name !== 'string' || !entry.name.trim()) {
    return null;
  }

  return {
    name: entry.name.trim(),
    path: typeof entry.path === 'string' ? entry.path : '',
    description: typeof entry.description === 'string' ? entry.description : '',
    downloadPath: typeof entry.downloadPath === 'string' ? entry.downloadPath : undefined,
    source,
  } satisfies SkillRecord;
}

function isSkillRecord(entry: SkillRecord | null): entry is SkillRecord {
  return entry !== null;
}

async function listPrismMemorySkills() {
  if (!config.prismApiBase || !config.prismApiKey) {
    return [] as SkillRecord[];
  }

  const response = await prismRequest('/skills');
  const payload = await response.json() as SkillIndexResponse;
  return (Array.isArray(payload.skills) ? payload.skills : [])
    .map((entry) => normalizeSkillRecord('prism-memory', entry))
    .filter(isSkillRecord);
}

async function listAppHostedSkills() {
  if (!config.appApiBaseUrl || !config.appServiceToken) {
    return [] as SkillRecord[];
  }

  const response = await appApiRequest('/api/internal/skills');
  const payload = await response.json() as SkillIndexResponse;
  return (Array.isArray(payload.skills) ? payload.skills : [])
    .map((entry) => normalizeSkillRecord('app-api', entry))
    .filter(isSkillRecord);
}

export async function listPrismSkills() {
  if (skillIndexCache && hasValidCache(skillIndexCache.fetchedAt)) {
    return skillIndexCache.skills;
  }

  const [prismSkills, appSkills] = await Promise.all([
    listPrismMemorySkills().catch(() => [] as SkillRecord[]),
    listAppHostedSkills().catch(() => [] as SkillRecord[]),
  ]);

  const skills = [...prismSkills, ...appSkills].sort((left, right) => left.name.localeCompare(right.name));
  skillIndexCache = { skills, fetchedAt: Date.now() };
  return skills;
}

function extractSkillMarkdownFromArchive(archive: Uint8Array, skillName: string) {
  const extract = tar.extract();

  return new Promise<string>((resolve, reject) => {
    let resolved = false;

    extract.on('entry', (header: { name: string }, stream: NodeJS.ReadableStream, next: () => void) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer | Uint8Array | string) => {
        chunks.push(Buffer.from(chunk));
      });
      stream.on('end', () => {
        if (!resolved && header.name.endsWith('/SKILL.md')) {
          resolved = true;
          resolve(Buffer.concat(chunks).toString('utf8'));
        }
        next();
      });
      stream.on('error', reject);
      stream.resume();
    });

    extract.on('finish', () => {
      if (!resolved) {
        reject(new Error(`PRISM_SKILL_ARCHIVE_INVALID:${skillName}`));
      }
    });

    extract.on('error', reject);
    extract.end(Buffer.from(gunzipSync(archive)));
  });
}

export async function downloadPrismSkill(skillName: string) {
  const cached = skillContentCache.get(skillName);
  if (cached && hasValidCache(cached.fetchedAt)) {
    return cached.content;
  }

  const availableSkills = await listPrismSkills();
  const skill = availableSkills.find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`SKILL_NOT_FOUND:${skillName}`);
  }

  let response: Response;
  if (skill.source === 'app-api') {
    const downloadPath = skill.downloadPath || `/api/internal/skills/${encodeURIComponent(skillName)}/download`;
    response = await appApiRequest(downloadPath);
  } else {
    response = await prismRequest(`/skills/${encodeURIComponent(skillName)}/download`);
  }

  const archive = new Uint8Array(await response.arrayBuffer());
  const content = await extractSkillMarkdownFromArchive(archive, skillName);
  skillContentCache.set(skillName, {
    content,
    fetchedAt: Date.now(),
  });
  return content;
}

function requestedSkillNames(prompt: string, metadata?: Record<string, unknown>) {
  const requested = new Set<string>();
  const normalized = prompt.toLowerCase();
  const explicit = metadata?.requestedSkills;

  if (Array.isArray(explicit)) {
    for (const entry of explicit) {
      if (typeof entry === 'string' && entry.trim()) {
        requested.add(entry.trim());
      }
    }
  }

  if (
    normalized.includes('remember')
    || normalized.includes('what do we know')
    || normalized.includes('what do you know')
    || normalized.includes('search')
    || normalized.includes('knowledge')
    || normalized.includes('memory')
    || normalized.includes('context')
  ) {
    requested.add('prism-api-reader');
  }

  if (
    normalized.includes('write')
    || normalized.includes('save')
    || normalized.includes('store')
    || normalized.includes('record')
    || normalized.includes('add to memory')
    || normalized.includes('create doc')
    || normalized.includes('inbox')
  ) {
    requested.add('prism-api-writer');
  }

  if (
    normalized.includes('run ')
    || normalized.includes('trigger')
    || normalized.includes('backfill')
    || normalized.includes('promote')
    || normalized.includes('validate')
    || normalized.includes('index')
    || normalized.includes('recompute')
    || normalized.includes('ops')
  ) {
    requested.add('prism-api-ops');
  }

  if (
    normalized.includes('config')
    || normalized.includes('configure')
    || normalized.includes('space config')
    || normalized.includes('space.json')
    || normalized.includes('agentic ingest')
    || normalized.includes('memory policy')
    || normalized.includes('priority channel')
    || normalized.includes('priority topic')
    || normalized.includes('scoped bucket')
    || normalized.includes('scoped source')
    || normalized.includes('turn on bot_only')
    || normalized.includes('turn off agentic')
    || normalized.includes('backfill')
  ) {
    requested.add('prism-config-admin');
  }

  if (
    normalized.includes('change request')
    || normalized.includes('change-request')
    || normalized.includes('next request')
    || normalized.includes('current request')
    || normalized.includes('execution record')
    || normalized.includes('deploy plan')
  ) {
    requested.add('change-request-ops');
  }

  if (
    normalized.includes('deploy')
    || normalized.includes('redeploy')
    || normalized.includes('staging')
    || normalized.includes('build')
    || normalized.includes('restart')
    || normalized.includes('target app')
  ) {
    requested.add('target-deploy-ops');
  }

  return Array.from(requested);
}

export async function loadRelevantPrismSkills(prompt: string, metadata?: Record<string, unknown>) {
  const availableSkills = await listPrismSkills().catch(() => [] as SkillRecord[]);
  if (!availableSkills.length) {
    return {
      availableSkills: [] as SkillRecord[],
      selectedSkills: [] as Array<{ name: string; content: string }>,
    };
  }

  const requested = new Set(requestedSkillNames(prompt, metadata));
  const selectedSkills: Array<{ name: string; content: string }> = [];

  for (const skill of availableSkills) {
    if (!requested.has(skill.name)) {
      continue;
    }

    const content = await downloadPrismSkill(skill.name);
    selectedSkills.push({
      name: skill.name,
      content,
    });
  }

  return { availableSkills, selectedSkills };
}
