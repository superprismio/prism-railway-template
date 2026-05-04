import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { type RequestArtifactRecord } from './repository';

const artifactRootName = 'workflow-artifacts';

function sanitizeFilename(value: string) {
  const candidate = value
    .trim()
    .replace(/[/\\]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return candidate || 'artifact';
}

export function workflowArtifactsRoot() {
  return path.resolve(loadConfig().dataRoot, artifactRootName);
}

export function buildRequestArtifactStoragePath(input: {
  requestId: string;
  artifactId: string;
  name: string;
}) {
  const filename = `${input.artifactId}-${sanitizeFilename(input.name)}`;
  return path.join('requests', input.requestId, filename);
}

export function resolveRequestArtifactStoragePath(storagePath: string) {
  const root = workflowArtifactsRoot();
  const resolved = path.resolve(root, storagePath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('ARTIFACT_PATH_OUTSIDE_ROOT');
  }

  return resolved;
}

export async function writeRequestArtifactFile(storagePath: string, content: Buffer) {
  const resolved = resolveRequestArtifactStoragePath(storagePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content);
}

export async function readRequestArtifactFile(artifact: RequestArtifactRecord) {
  return fs.readFile(resolveRequestArtifactStoragePath(artifact.storagePath));
}

export async function deleteRequestArtifactFile(storagePath: string) {
  await fs.rm(resolveRequestArtifactStoragePath(storagePath), { force: true });
}

export function safeArtifactMimeType(value: string | null | undefined) {
  const candidate = value?.trim() || '';
  return /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:\s*;\s*[A-Za-z0-9_.-]+=[A-Za-z0-9_.-]+)*$/.test(candidate)
    ? candidate
    : 'application/octet-stream';
}

export function safeArtifactContentDisposition(name: string | null | undefined) {
  const safeName = (name ?? '')
    .replace(/[\x00-\x1F\x7F"\\]/g, '')
    .replace(/[^\x20-\x7E]+/g, '_')
    .trim() || 'artifact';
  return `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
