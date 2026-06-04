import process from 'node:process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { generateCodexCliReply } from './codex-runtime.js';
import { listPrismSkills } from './prism-skills.js';

const startedAt = new Date();
const app = express();
const responseJobs = new Map<string, RuntimeResponseJob>();

app.use(express.json({ limit: '1mb' }));

type RuntimeRequestBody = {
  prompt?: unknown;
  sessionId?: unknown;
  codexThreadId?: unknown;
  recentHistory?: Array<{ role?: unknown; content?: unknown }>;
  metadata?: Record<string, unknown>;
};

type RuntimeResponsePayload = {
  id: string | null;
  object: 'response';
  model: string | null;
  provider: string;
  responseText: string;
  output_text: string;
  thread_id: string | null;
  branchName: string | null;
  commitSha: string | null;
  branchUrl: string | null;
  baseBranch: string | null;
  baseCommitSha: string | null;
  trace: Array<{ at: string; kind: string; message: string }>;
  sessionId: string;
};

type RuntimeResponseJob = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  input: {
    prompt: string;
    sessionId: string;
    codexThreadId: string | null;
    recentHistory: Array<{ role: string; content: string }>;
    metadata: Record<string, unknown>;
  };
  response: RuntimeResponsePayload | null;
  error: string | null;
  threadId: string | null;
  trace: Array<{ at: string; kind: string; message: string }>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

async function pathExists(filePath: string) {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

type CodexCustomProviderConfig = {
  model: string | null;
  modelProvider: string | null;
  providerName: string | null;
  providerBaseUrl: string | null;
  providerEnvKey: string | null;
  providerEnvConfigured: boolean | null;
  providerTokenConfigured: boolean;
  wireApi: string | null;
  configPath: string;
  error: string | null;
};

function parseTomlString(value: string) {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^"((?:\\.|[^"\\])*)"$/) ?? trimmed.match(/^'([^']*)'$/);
  if (!quoted) {
    return null;
  }
  return quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseSimpleToml(content: string) {
  const root: Record<string, string> = {};
  const tables = new Map<string, Record<string, string>>();
  let current: Record<string, string> = root;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      const tableName = tableMatch[1].trim();
      current = tables.get(tableName) ?? {};
      tables.set(tableName, current);
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }
    const parsed = parseTomlString(assignment[2]);
    if (parsed !== null) {
      current[assignment[1].trim()] = parsed;
    }
  }

  return { root, tables };
}

async function readCodexCustomProviderConfig(): Promise<CodexCustomProviderConfig | null> {
  if (!config.codexHome) {
    return null;
  }
  const configPath = path.join(config.codexHome, 'config.toml');
  let content = '';
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch {
    return null;
  }

  const parsed = parseSimpleToml(content);
  const model = parsed.root.model || null;
  const modelProvider = parsed.root.model_provider || null;
  if (!modelProvider) {
    return {
      model,
      modelProvider: null,
      providerName: null,
      providerBaseUrl: null,
      providerEnvKey: null,
      providerEnvConfigured: null,
      providerTokenConfigured: false,
      wireApi: null,
      configPath,
      error: 'missing model_provider',
    };
  }

  const providerTable = parsed.tables.get(`model_providers.${modelProvider}`) ?? null;
  if (!providerTable) {
    return {
      model,
      modelProvider,
      providerName: null,
      providerBaseUrl: null,
      providerEnvKey: null,
      providerEnvConfigured: null,
      providerTokenConfigured: false,
      wireApi: null,
      configPath,
      error: `missing [model_providers.${modelProvider}]`,
    };
  }

  const providerEnvKey = providerTable.env_key || null;
  const providerTokenConfigured = Boolean(providerTable.experimental_bearer_token?.trim());
  const providerEnvConfigured = providerEnvKey ? Boolean(process.env[providerEnvKey]?.trim()) : null;
  const providerBaseUrl = providerTable.base_url || null;
  const error =
    !providerBaseUrl
      ? 'missing provider base_url'
      : providerEnvKey && !providerEnvConfigured
        ? `missing provider env ${providerEnvKey}`
        : !providerEnvKey && !providerTokenConfigured
          ? 'missing provider env_key or experimental_bearer_token'
          : null;

  return {
    model,
    modelProvider,
    providerName: providerTable.name || null,
    providerBaseUrl,
    providerEnvKey,
    providerEnvConfigured,
    providerTokenConfigured,
    wireApi: providerTable.wire_api || null,
    configPath,
    error,
  };
}

async function codexAuthStatus() {
  if (!config.codexHome) {
    return {
      configured: false,
      mode: 'not-configured',
      customProvider: null,
    };
  }
  const deviceAuthConfigured = await pathExists(path.join(config.codexHome, 'auth.json'));
  if (deviceAuthConfigured) {
    return {
      configured: true,
      mode: 'device-auth',
      customProvider: null,
    };
  }
  const customProvider = await readCodexCustomProviderConfig();
  const customProviderConfigured = Boolean(customProvider && !customProvider.error);
  return {
    configured: customProviderConfigured,
    mode: customProvider ? 'custom-provider' : 'not-configured',
    customProvider,
  };
}

function normalizeRuntimeRequest(body: RuntimeRequestBody) {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

  if (!prompt || !sessionId) {
    return null;
  }

  return {
    prompt,
    sessionId,
    codexThreadId: typeof body.codexThreadId === 'string' ? body.codexThreadId.trim() : null,
    recentHistory: Array.isArray(body.recentHistory)
      ? body.recentHistory
        .map((entry) => ({
          role: typeof entry?.role === 'string' ? entry.role : 'user',
          content: typeof entry?.content === 'string' ? entry.content : '',
        }))
        .filter((entry) => entry.content.trim())
      : [],
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  };
}

function responsePayloadFromResult(
  result: Awaited<ReturnType<typeof generateCodexCliReply>>,
  sessionId: string,
): RuntimeResponsePayload {
  return {
    id: result.codexThreadId,
    object: 'response',
    model: result.model,
    provider: result.provider,
    responseText: result.responseText,
    output_text: result.responseText,
    thread_id: result.codexThreadId,
    branchName: result.branchName,
    commitSha: result.commitSha,
    branchUrl: result.branchUrl,
    baseBranch: result.baseBranch,
    baseCommitSha: result.baseCommitSha,
    trace: result.trace,
    sessionId,
  };
}

function errorPayload(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown codex runtime error';
  const candidate = error as Error & {
    codexThreadId?: string | null;
    trace?: Array<{ at: string; kind: string; message: string }>;
  };
  return {
    ok: false,
    error: message,
    thread_id: candidate.codexThreadId ?? null,
    trace: Array.isArray(candidate.trace) ? candidate.trace : [],
  };
}

function pruneResponseJobs() {
  const completed = [...responseJobs.values()]
    .filter((job) => job.status === 'succeeded' || job.status === 'failed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (responseJobs.size > 100 && completed.length) {
    const job = completed.shift();
    if (job) responseJobs.delete(job.id);
  }
}

async function runResponseJob(jobId: string) {
  const job = responseJobs.get(jobId);
  if (!job) return;

  job.status = 'running';
  job.startedAt = new Date().toISOString();

  try {
    const result = await generateCodexCliReply({
      ...job.input,
      onTrace: (trace) => {
        job.trace = [...trace];
      },
    });
    job.response = responsePayloadFromResult(result, job.input.sessionId);
    job.threadId = result.codexThreadId;
    job.trace = result.trace;
    job.status = 'succeeded';
  } catch (error) {
    const payload = errorPayload(error);
    job.error = payload.error;
    job.threadId = payload.thread_id;
    job.trace = payload.trace;
    job.status = 'failed';
  } finally {
    job.finishedAt = new Date().toISOString();
    pruneResponseJobs();
  }
}

app.get('/health', async (_req, res) => {
  const authStatus = await codexAuthStatus();
  res.json({
    ok: true,
    service: 'codex-runtime',
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: startedAt.toISOString(),
    codexBinary: config.codexBinary,
    codexHome: config.codexHome,
    codexAuthConfigured: authStatus.configured,
    codexAuthMode: authStatus.mode,
    codexModel: config.codexModel ?? authStatus.customProvider?.model ?? null,
    codexModelProvider: authStatus.customProvider?.modelProvider ?? null,
    codexProviderName: authStatus.customProvider?.providerName ?? null,
    codexProviderBaseUrl: authStatus.customProvider?.providerBaseUrl ?? null,
    codexProviderEnvKey: authStatus.customProvider?.providerEnvKey ?? null,
    codexProviderEnvConfigured: authStatus.customProvider?.providerEnvConfigured ?? null,
    codexProviderTokenConfigured: authStatus.customProvider?.providerTokenConfigured ?? false,
    codexProviderWireApi: authStatus.customProvider?.wireApi ?? null,
    codexProviderConfigPath: authStatus.customProvider?.configPath ?? null,
    codexProviderConfigError: authStatus.customProvider?.error ?? null,
    codexRuntimeEnabled: config.codexRuntimeEnabled,
    codexImageGenerationEnabled: config.codexImageGenerationEnabled,
  });
});

app.get('/codex/health', (_req, res) => {
  res.json({ ok: true, provider: 'codex-cli' });
});

app.get('/skills', async (_req, res) => {
  try {
    const skills = await listPrismSkills();
    res.json({ ok: true, skills });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown skills error';
    res.status(500).json({ ok: false, error: message });
  }
});

app.post('/v1/responses', async (req, res) => {
  const input = normalizeRuntimeRequest(req.body as RuntimeRequestBody);

  if (!input) {
    res.status(400).json({ ok: false, error: 'prompt and sessionId are required' });
    return;
  }

  try {
    const result = await generateCodexCliReply(input);
    res.json(responsePayloadFromResult(result, input.sessionId));
  } catch (error) {
    res.status(500).json(errorPayload(error));
  }
});

app.post('/v1/responses/jobs', (req, res) => {
  const input = normalizeRuntimeRequest(req.body as RuntimeRequestBody);
  if (!input) {
    res.status(400).json({ ok: false, error: 'prompt and sessionId are required' });
    return;
  }

  const jobId = randomUUID();
  const now = new Date().toISOString();
  responseJobs.set(jobId, {
    id: jobId,
    status: 'queued',
    input,
    response: null,
    error: null,
    threadId: input.codexThreadId,
    trace: [],
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  });
  void runResponseJob(jobId);

  res.status(202).json({
    ok: true,
    jobId,
    job: responseJobs.get(jobId),
  });
});

app.get('/v1/responses/jobs/:jobId', (req, res) => {
  const job = responseJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: 'Runtime response job not found' });
    return;
  }

  res.json({
    ok: job.status !== 'failed',
    job,
    response: job.response,
    error: job.error,
    thread_id: job.threadId,
    trace: job.trace,
  });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`codex-runtime listening on ${config.port}`);
});
