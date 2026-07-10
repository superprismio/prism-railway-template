import process from 'node:process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { generateCodexCliReply } from './codex-runtime.js';
import { GatewayClientError } from './gateway-client.js';
import { listPrismSkills } from './prism-skills.js';
import { RuntimeCapabilityError } from './runtime-capabilities.js';
import { gatewayClient, runtimeCapabilitySessions } from './runtime-gateway.js';

const startedAt = new Date();
const app = express();
const responseJobs = new Map<string, RuntimeResponseJob>();

app.use(express.json({ limit: '1mb' }));

type RuntimeRequestBody = {
  prompt?: unknown;
  sessionId?: unknown;
  codexThreadId?: unknown;
  recentHistory?: Array<{ role?: unknown; content?: unknown }>;
  capabilities?: unknown;
  context?: unknown;
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
    capabilities: string[];
    gatewayContext: Record<string, string>;
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

async function codexAuthConfigured() {
  if (!config.codexHome) {
    return false;
  }
  return pathExists(path.join(config.codexHome, 'auth.json'));
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
    capabilities: Array.isArray(body.capabilities)
      ? Array.from(new Set(body.capabilities
        .map((entry) => {
          if (typeof entry === 'string') return entry.trim();
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const key = (entry as Record<string, unknown>).key;
            return typeof key === 'string' ? key.trim() : '';
          }
          return '';
        })
        .filter((key) => /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(key))))
      : [],
    gatewayContext: normalizeGatewayContext(body.context),
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  };
}

function normalizeGatewayContext(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const allowedKeys = [
    'delegatedActorId',
    'requestId',
    'workflowRunId',
    'workflowStepKey',
  ];
  return Object.fromEntries(allowedKeys.flatMap((key) => {
    const candidate = input[key];
    return typeof candidate === 'string' && candidate.trim()
      ? [[key, candidate.trim().slice(0, 200)]]
      : [];
  }));
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
      gatewayContext: {
        ...job.input.gatewayContext,
        runtimeJobId: job.id,
      },
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
  res.json({
    ok: true,
    service: 'codex-runtime',
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: startedAt.toISOString(),
    codexBinary: config.codexBinary,
    codexHome: config.codexHome,
    codexAuthConfigured: await codexAuthConfigured(),
    codexRuntimeEnabled: config.codexRuntimeEnabled,
    codexImageGenerationEnabled: config.codexImageGenerationEnabled,
    prismGateway: gatewayClient.status(),
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

app.post('/v1/runtime/capabilities/invoke', async (req, res) => {
  const token = typeof req.header('x-runtime-capability-token') === 'string'
    ? req.header('x-runtime-capability-token')!.trim()
    : '';
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const capability = typeof body.capability === 'string' ? body.capability.trim() : '';
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input)
    ? body.input as Record<string, unknown>
    : null;
  if (!token || !capability || !input) {
    res.status(400).json({ ok: false, error: 'RUNTIME_CAPABILITY_REQUEST_INVALID' });
    return;
  }

  try {
    const result = await runtimeCapabilitySessions.invoke(token, capability, input);
    res.status(result.status).json(result);
  } catch (error) {
    if (error instanceof RuntimeCapabilityError) {
      res.status(error.status).json({ ok: false, error: error.code });
      return;
    }
    if (error instanceof GatewayClientError) {
      res.status(error.status).json({
        ok: false,
        error: error.code,
        retryable: error.retryable,
        traceId: error.traceId,
      });
      return;
    }
    res.status(500).json({ ok: false, error: 'RUNTIME_CAPABILITY_INVOKE_FAILED' });
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
