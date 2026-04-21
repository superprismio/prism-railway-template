import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const sourceRoot = process.argv[2] || '/tmp/RG-handbook-nextra';
const outputPath =
  process.argv[3] || path.join(repoRoot, 'docs', 'knowledge-sync', 'raidguild-handbook-nextra.json');
const generatedAt = new Date().toISOString();

const allowedTags = new Set([
  'general',
  'knowledge',
  'meetings',
  'memory',
  'operations',
  'workflow',
  'meeting',
  'announcement',
  'newsletter',
  'template',
  'onboarding',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFiles(dir) {
  const entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...listFiles(fullPath));
      continue;
    }
    entries.push(fullPath);
  }
  return entries;
}

function stripMdx(raw) {
  let text = raw.replace(/^import\s.+?;$/gm, '');
  text = text.replace(/<Callout>/g, '\n> ');
  text = text.replace(/<\/Callout>/g, '\n');
  text = text.replace(/<img[^>]*\/?>/g, '');
  text = text.replace(/<\/?div[^>]*>/g, '');
  text = text.replace(/className=\{[^}]+\}/g, '');
  text = text.replace(/<[^>\n]+>/g, '');
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  text = text.replace(/!\[[^\]]*\]\(\)/g, '');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  text = text.replace(/^\s*>\s*$/gm, '');
  text = text.replace(/^\s+$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function cleanInlineText(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/!\[[^\]]*\]\(\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? cleanInlineText(match[1]) : '';
}

function firstParagraph(markdown) {
  const blocks = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  for (const block of blocks) {
    if (block.startsWith('#')) continue;
    if (block.startsWith('![')) continue;
    if (block.startsWith('>')) {
      const normalized = cleanInlineText(block.replace(/^>\s?/gm, '').trim());
      if (normalized) return normalized;
      continue;
    }
    return cleanInlineText(block);
  }
  return '';
}

function titleCase(value) {
  return value
    .split(/[-_/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function relPosix(filePath) {
  return path.relative(sourceRoot, filePath).split(path.sep).join('/');
}

function getUpdated(filePath) {
  try {
    return execFileSync('git', ['-C', sourceRoot, 'log', '-1', '--format=%cI', '--', relPosix(filePath)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return generatedAt;
  }
}

function routeParts(filePath) {
  const rel = relPosix(filePath);
  if (rel === 'app/page.mdx') return [];
  const withoutPrefix = rel.replace(/^app\//, '');
  const parts = withoutPrefix.split('/');
  if (parts.at(-1) === 'page.mdx') parts.pop();
  return parts;
}

function lookupNavTitle(parts) {
  if (parts.length === 0) {
    const meta = readJson(path.join(sourceRoot, 'app', '_meta.json'));
    return meta.index?.title || 'RaidGuild Handbook';
  }
  const appMetaPath = path.join(sourceRoot, 'app', '_meta.json');
  const appMeta = fs.existsSync(appMetaPath) ? readJson(appMetaPath) : {};
  if (parts.length === 1) {
    return appMeta[parts[0]]?.title || titleCase(parts[0]);
  }
  const sectionMetaPath = path.join(sourceRoot, 'app', parts[0], '_meta.json');
  if (fs.existsSync(sectionMetaPath)) {
    const sectionMeta = readJson(sectionMetaPath);
    return sectionMeta[parts[1]]?.title || titleCase(parts[1]);
  }
  return titleCase(parts.at(-1));
}

function slugFor(parts) {
  return parts.length === 0 ? 'raidguild-handbook-home' : `raidguild-handbook-${parts.join('-')}`;
}

function kindFor(parts) {
  const tail = parts.at(-1) || '';
  const section = parts[0] || '';
  if (tail === 'code-of-conduct') return 'policy';
  if (tail === 'glossary') return 'reference';
  if (['dao-roles', 'dao-tokens', 'design-system', 'rips', 'bots'].includes(tail)) return 'reference';
  if (section === 'resources') return 'guide';
  return 'guide';
}

function tagsFor(parts) {
  const section = parts[0] || 'overview';
  const tail = parts.at(-1) || '';
  const tags = new Set(['knowledge']);
  if (section === 'overview' || section === 'resources') tags.add('general');
  if (section === 'membership' || section === 'discord') tags.add('onboarding');
  if (section === 'dao-operations' || section === 'escrow') tags.add('operations');
  if (section === 'raids' || section === 'escrow' || section === 'membership' || section === 'dao-operations') {
    tags.add('workflow');
  }
  if (tail === 'meetings') tags.add('meetings');
  return [...tags].filter((tag) => allowedTags.has(tag)).sort();
}

function entitiesFor(parts, content) {
  const section = parts[0] || '';
  const tail = parts.at(-1) || '';
  const entities = new Set(['RaidGuild']);
  if (section === 'discord' || /discord/i.test(content)) entities.add('Discord');
  if (section === 'dao-operations' || /dao/i.test(content)) entities.add('DAO');
  if (section === 'escrow' || /escrow/i.test(content)) entities.add('Escrow');
  if (/smartinvoice|smart invoice/i.test(content) || tail === 'intro-to-smartinvoice') entities.add('Smart Invoice');
  if (/optimism/i.test(content) || tail === 'raiding-on-optimism-chain') entities.add('Optimism');
  if (/web3/i.test(content) || section === 'resources') entities.add('Web3');
  return [...entities].slice(0, 20);
}

function relatedDocsFor(parts) {
  const related = new Set();
  if (parts.length > 0) related.add('raidguild-handbook-home');
  if (parts.length > 1) related.add(`raidguild-handbook-${parts[0]}`);
  related.delete(slugFor(parts));
  return [...related];
}

function buildContent(title, filePath, cleanedBody) {
  const rel = relPosix(filePath);
  const sourceUrl = `https://github.com/dekanbro/RG-handbook-nextra/blob/main/${rel}`;
  const body = cleanedBody.replace(/^#\s+.+$/m, '').trim();
  return [
    `# ${title}`,
    '',
    `Source repo: \`dekanbro/RG-handbook-nextra\``,
    `Source path: \`${rel}\``,
    `Source URL: ${sourceUrl}`,
    '',
    body,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildEntry(filePath) {
  const parts = routeParts(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const cleaned = stripMdx(raw);
  const title = firstHeading(cleaned) || lookupNavTitle(parts);
  const slug = slugFor(parts);
  const content = buildContent(title, filePath, cleaned);
  const summary = firstParagraph(cleaned).slice(0, 280) || `${title} from the RaidGuild handbook.`;
  return {
    filename: `${slug}.md`,
    content,
    metadata: {
      title,
      slug,
      kind: kindFor(parts),
      summary,
      tags: tagsFor(parts),
      owners: ['raidguild'],
      status: 'active',
      audience: 'public',
      stability: 'evolving',
      updated: getUpdated(filePath),
      entities: entitiesFor(parts, cleaned),
      related_docs: relatedDocsFor(parts),
      triaged_at: generatedAt,
      source_repo: 'dekanbro/RG-handbook-nextra',
      source_path: relPosix(filePath),
      source_url: `https://github.com/dekanbro/RG-handbook-nextra/blob/main/${relPosix(filePath)}`,
    },
  };
}

const appRoot = path.join(sourceRoot, 'app');
const entries = listFiles(appRoot)
  .filter((filePath) => filePath.endsWith('page.mdx'))
  .sort()
  .map(buildEntry);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  JSON.stringify(
    {
      sync_source: 'RG-handbook-nextra',
      source_repo: 'https://github.com/dekanbro/RG-handbook-nextra',
      generated_at: generatedAt,
      entry_count: entries.length,
      entries,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

console.log(JSON.stringify({ ok: true, outputPath, entryCount: entries.length }, null, 2));
