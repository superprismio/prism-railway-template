import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface HostedSkillSummary {
  name: string;
  path: string;
  description: string | null;
}

function readSkillDescription(skillFilePath: string) {
  const lines = fs.readFileSync(skillFilePath, 'utf8').split(/\r?\n/);
  let inFrontmatter = false;
  let frontmatterConsumed = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!frontmatterConsumed && trimmed === '---') {
      inFrontmatter = !inFrontmatter;
      if (!inFrontmatter) {
        frontmatterConsumed = true;
      }
      continue;
    }

    if (inFrontmatter) {
      continue;
    }

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    return trimmed;
  }

  return null;
}

function ensureDirectoryPath(candidatePath: string, rootPath: string) {
  const resolved = path.resolve(candidatePath);
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Resolved skill path escapes hosted skills root');
  }

  return resolved;
}

export function getHostedSkillsRoot(workspaceRoot: string) {
  return path.resolve(workspaceRoot, 'skills');
}

export function listHostedSkills(workspaceRoot: string) {
  const rootPath = getHostedSkillsRoot(workspaceRoot);
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillDir = ensureDirectoryPath(path.join(rootPath, entry.name), rootPath);
      const skillFilePath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFilePath)) {
        return null;
      }

      return {
        name: entry.name,
        path: path.relative(workspaceRoot, skillDir),
        description: readSkillDescription(skillFilePath),
      } satisfies HostedSkillSummary;
    })
    .filter((entry): entry is HostedSkillSummary => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveHostedSkillDirectory(workspaceRoot: string, skillName: string) {
  const normalizedSkillName = skillName.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalizedSkillName)) {
    return null;
  }

  const rootPath = getHostedSkillsRoot(workspaceRoot);
  const skillDir = ensureDirectoryPath(path.join(rootPath, normalizedSkillName), rootPath);
  const skillFilePath = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillFilePath)) {
    return null;
  }

  return skillDir;
}

export function buildHostedSkillArchive(workspaceRoot: string, skillName: string) {
  const skillDir = resolveHostedSkillDirectory(workspaceRoot, skillName);
  if (!skillDir) {
    return null;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-agent-skill-'));

  try {
    const archivePath = path.join(tempDir, `${skillName}.tar.gz`);
    execFileSync('tar', ['-czf', archivePath, '-C', path.dirname(skillDir), path.basename(skillDir)]);
    return fs.readFileSync(archivePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
