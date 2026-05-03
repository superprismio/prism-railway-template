import fs from 'node:fs';
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

export function writeRequestArtifactFile(storagePath: string, content: Buffer) {
  const resolved = resolveRequestArtifactStoragePath(storagePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
}

export function readRequestArtifactFile(artifact: RequestArtifactRecord) {
  return fs.readFileSync(resolveRequestArtifactStoragePath(artifact.storagePath));
}
