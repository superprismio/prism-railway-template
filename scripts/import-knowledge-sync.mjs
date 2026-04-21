import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    manifest: path.join(process.cwd(), 'docs', 'knowledge-sync', 'raidguild-handbook-nextra.json'),
    baseUrl: process.env.PRISM_API_BASE || '',
    apiKey: process.env.PRISM_API_KEY || '',
    limit: null,
    start: 0,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--manifest') args.manifest = argv[++i];
    else if (token === '--base-url') args.baseUrl = argv[++i];
    else if (token === '--api-key') args.apiKey = argv[++i];
    else if (token === '--limit') args.limit = Number(argv[++i]);
    else if (token === '--start') args.start = Number(argv[++i]);
    else throw new Error(`Unknown arg: ${token}`);
  }

  if (!args.baseUrl) throw new Error('Missing --base-url or PRISM_API_BASE');
  if (!args.apiKey) throw new Error('Missing --api-key or PRISM_API_KEY');
  return args;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

async function postEntry(baseUrl, apiKey, entry) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/knowledge/inbox`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Prism-Api-Key': apiKey,
    },
    body: JSON.stringify(entry),
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (response.ok) {
    return { status: 'imported', code: response.status, body };
  }

  const errorCode = body?.error?.code || body?.detail?.error?.code || 'unknown_error';
  const errorMessage =
    body?.error?.message || body?.detail?.error?.message || response.statusText || 'Request failed';

  if (errorCode === 'file_exists') {
    return { status: 'skipped', code: response.status, body, reason: errorMessage };
  }

  return { status: 'failed', code: response.status, body, reason: errorMessage };
}

const args = parseArgs(process.argv);
const payload = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
const entries = payload.entries.slice(args.start, args.limit ? args.start + args.limit : undefined);

const results = [];
for (const entry of entries) {
  // Keep writes serialized to make it easy to reason about partial imports.
  const result = await postEntry(args.baseUrl, args.apiKey, entry);
  results.push({
    filename: entry.filename,
    slug: entry.metadata?.slug || null,
    ...result,
  });
  if (result.status === 'failed') {
    break;
  }
}

const summary = {
  ok: results.every((item) => item.status !== 'failed'),
  manifest: args.manifest,
  source: payload.sync_source || null,
  attempted: results.length,
  imported: results.filter((item) => item.status === 'imported').length,
  skipped: results.filter((item) => item.status === 'skipped').length,
  failed: results.filter((item) => item.status === 'failed').length,
  results,
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
