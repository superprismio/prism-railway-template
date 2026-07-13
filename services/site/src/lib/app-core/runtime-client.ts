import {
  prismRuntimeContractVersion,
  resolveRuntimeProfile,
  type RuntimeProfileRecord,
} from './runtime-profiles';

export type RuntimeTraceEntry = { at: string; kind: string; message: string };

export type RuntimeResponse = {
  id: string | null;
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
  trace: RuntimeTraceEntry[];
  runtimeKey: string;
};

export type RuntimeRequestInput = {
  prompt: string;
  sessionId: string;
  continuationId?: string | null;
  recentHistory?: Array<{ role: string; content: string }>;
  skills?: string[];
  capabilities?: Array<string | { key: string; [key: string]: unknown }>;
  toolsets?: Array<{ key: string; protocol?: 'openapi' | 'mcp' | 'http' | 'adapter' }>;
  context?: Record<string, string | undefined>;
  metadata?: Record<string, unknown>;
  runtimeKey?: string | null;
  timeoutMs?: number;
  onProgress?: (progress: {
    status: string;
    runtimeJobId: string;
    threadId: string | null;
    trace: RuntimeTraceEntry[];
  }) => void;
};

type NormalizedJob = {
  id?: string;
  status?: string;
  result?: {
    responseText?: string;
    continuationId?: string | null;
    providerMetadata?: Record<string, unknown>;
  } | null;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
  trace?: Array<{ at?: string; kind?: string; message?: string }>;
};

type NormalizedJobPayload = {
  ok?: boolean;
  jobId?: string;
  job?: NormalizedJob;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
};

type LegacyResponse = {
  error?: string | null;
  id?: string | null;
  model?: string | null;
  provider?: string | null;
  responseText?: string;
  output_text?: string;
  thread_id?: string | null;
  branchName?: string | null;
  commitSha?: string | null;
  branchUrl?: string | null;
  baseBranch?: string | null;
  baseCommitSha?: string | null;
  trace?: Array<{ at?: string; kind?: string; message?: string }>;
};

type LegacyJobPayload = {
  jobId?: string;
  job?: {
    status?: string;
    response?: LegacyResponse | null;
    error?: string | null;
    threadId?: string | null;
    trace?: Array<{ at?: string; kind?: string; message?: string }>;
  };
  response?: LegacyResponse | null;
  error?: string | null;
  thread_id?: string | null;
  trace?: Array<{ at?: string; kind?: string; message?: string }>;
};

function defaultTimeoutMs() {
  const milliseconds = Number.parseInt(process.env.CODEX_RUNTIME_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds;
  const seconds = Number.parseInt(process.env.CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 660_000;
}

function traceEntries(value: unknown): RuntimeTraceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RuntimeTraceEntry[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message.trim() : '';
    if (!message) return [];
    return [{
      at: typeof record.at === 'string' ? record.at : new Date().toISOString(),
      kind: typeof record.kind === 'string' ? record.kind : 'runtime',
      message,
    }];
  });
}

function profileKeyFromMetadata(metadata: Record<string, unknown> | undefined) {
  const direct = metadata?.runtimeProfileKey ?? metadata?.runtimeKey;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const workflow = metadata?.workflow && typeof metadata.workflow === 'object' && !Array.isArray(metadata.workflow)
    ? metadata.workflow as Record<string, unknown>
    : null;
  const agentConfig = workflow?.agentConfig && typeof workflow.agentConfig === 'object' && !Array.isArray(workflow.agentConfig)
    ? workflow.agentConfig as Record<string, unknown>
    : null;
  const configured = agentConfig?.runtimeProfileKey ?? agentConfig?.runtimeKey;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const sessionRuntimeKey = metadata?.sessionRuntimeKey;
  return typeof sessionRuntimeKey === 'string' && sessionRuntimeKey.trim() ? sessionRuntimeKey.trim() : null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizedResponse(profile: RuntimeProfileRecord, job: NormalizedJob): RuntimeResponse {
  const metadata = job.result?.providerMetadata ?? {};
  const responseText = typeof job.result?.responseText === 'string' ? job.result.responseText.trim() : '';
  if (!responseText) throw new Error('RUNTIME_EMPTY_RESPONSE');
  const continuationId = typeof job.result?.continuationId === 'string' ? job.result.continuationId : null;
  return {
    id: continuationId,
    model: typeof metadata.model === 'string' ? metadata.model : null,
    provider: profile.adapter,
    responseText,
    output_text: responseText,
    thread_id: continuationId,
    branchName: typeof metadata.branchName === 'string' ? metadata.branchName : null,
    commitSha: typeof metadata.commitSha === 'string' ? metadata.commitSha : null,
    branchUrl: typeof metadata.branchUrl === 'string' ? metadata.branchUrl : null,
    baseBranch: typeof metadata.baseBranch === 'string' ? metadata.baseBranch : null,
    baseCommitSha: typeof metadata.baseCommitSha === 'string' ? metadata.baseCommitSha : null,
    trace: traceEntries(job.trace),
    runtimeKey: profile.key,
  };
}

function legacyResponse(profile: RuntimeProfileRecord, payload: LegacyResponse | null | undefined): RuntimeResponse {
  const responseText = typeof payload?.responseText === 'string' && payload.responseText.trim()
    ? payload.responseText.trim()
    : typeof payload?.output_text === 'string'
      ? payload.output_text.trim()
      : '';
  if (!responseText) throw new Error('RUNTIME_EMPTY_RESPONSE');
  return {
    id: payload?.id ?? payload?.thread_id ?? null,
    model: payload?.model ?? null,
    provider: payload?.provider ?? profile.adapter,
    responseText,
    output_text: responseText,
    thread_id: payload?.thread_id ?? payload?.id ?? null,
    branchName: payload?.branchName ?? null,
    commitSha: payload?.commitSha ?? null,
    branchUrl: payload?.branchUrl ?? null,
    baseBranch: payload?.baseBranch ?? null,
    baseCommitSha: payload?.baseCommitSha ?? null,
    trace: traceEntries(payload?.trace),
    runtimeKey: profile.key,
  };
}

async function cancelNormalizedJob(profile: RuntimeProfileRecord, jobId: string) {
  await fetch(`${profile.baseUrl}/v1/runtime/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  }).catch(() => null);
}

async function requestNormalized(
  profile: RuntimeProfileRecord,
  input: RuntimeRequestInput,
  timeoutMs: number,
): Promise<RuntimeResponse | null> {
  const startedAt = Date.now();
  const jobsUrl = `${profile.baseUrl}/v1/runtime/jobs`;
  const body = {
    contractVersion: prismRuntimeContractVersion,
    prompt: input.prompt,
    sessionId: input.sessionId,
    continuationId: input.continuationId ?? null,
    recentHistory: input.recentHistory ?? [],
    skills: (input.skills ?? []).map((name) => ({ name })),
    capabilities: (input.capabilities ?? []).map((entry) => typeof entry === 'string' ? { key: entry } : entry),
    toolsets: input.toolsets ?? [],
    context: input.context ?? {},
    metadata: input.metadata ?? {},
  };
  const submit = await fetchWithTimeout(jobsUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, Math.min(30_000, timeoutMs));
  if (submit.status === 404) return null;
  const accepted = await submit.json().catch(() => null) as NormalizedJobPayload | null;
  if (!submit.ok) {
    throw new Error(`RUNTIME_JOB_CREATE_FAILED:${submit.status}:${accepted?.error?.code || accepted?.error?.message || 'unknown'}`);
  }
  const jobId = typeof accepted?.jobId === 'string' ? accepted.jobId : '';
  if (!jobId) throw new Error('RUNTIME_JOB_CREATE_INVALID_RESPONSE');

  for (;;) {
    if (Date.now() - startedAt >= timeoutMs) {
      await cancelNormalizedJob(profile, jobId);
      throw new Error(`RUNTIME_REQUEST_TIMEOUT:${timeoutMs}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const poll = await fetchWithTimeout(
      `${jobsUrl}/${encodeURIComponent(jobId)}`,
      { cache: 'no-store' },
      Math.min(30_000, Math.max(1, timeoutMs - (Date.now() - startedAt))),
    );
    const payload = await poll.json().catch(() => null) as NormalizedJobPayload | null;
    if (!poll.ok) throw new Error(`RUNTIME_JOB_POLL_FAILED:${poll.status}:${payload?.error?.code || 'unknown'}`);
    const job = payload?.job;
    const status = typeof job?.status === 'string' ? job.status : '';
    input.onProgress?.({
      status,
      runtimeJobId: jobId,
      threadId: typeof job?.result?.continuationId === 'string' ? job.result.continuationId : null,
      trace: traceEntries(job?.trace),
    });
    if (status === 'queued' || status === 'running') continue;
    if (status === 'succeeded' && job) return normalizedResponse(profile, job);
    throw new Error(`RUNTIME_REQUEST_FAILED:${job?.error?.code || 'RUNTIME_JOB_FAILED'}:${job?.error?.message || 'Runtime job failed'}`);
  }
}

async function requestLegacy(profile: RuntimeProfileRecord, input: RuntimeRequestInput, timeoutMs: number) {
  const startedAt = Date.now();
  const body = {
    prompt: input.prompt,
    sessionId: input.sessionId,
    codexThreadId: input.continuationId ?? null,
    recentHistory: input.recentHistory ?? [],
    capabilities: input.capabilities ?? [],
    toolsets: input.toolsets ?? [],
    context: input.context ?? {},
    metadata: {
      ...(input.metadata ?? {}),
      ...((input.skills ?? []).length ? { requestedSkills: input.skills } : {}),
    },
  };
  const jobsUrl = `${profile.baseUrl}/v1/responses/jobs`;
  const submit = await fetchWithTimeout(jobsUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, Math.min(30_000, timeoutMs));
  if (submit.status !== 404) {
    const accepted = await submit.json().catch(() => null) as LegacyJobPayload | null;
    if (!submit.ok) throw new Error(`RUNTIME_JOB_CREATE_FAILED:${submit.status}:${accepted?.error || 'unknown'}`);
    const jobId = typeof accepted?.jobId === 'string' ? accepted.jobId : '';
    if (!jobId) throw new Error('RUNTIME_JOB_CREATE_INVALID_RESPONSE');
    for (;;) {
      if (Date.now() - startedAt >= timeoutMs) throw new Error(`RUNTIME_REQUEST_TIMEOUT:${timeoutMs}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const poll = await fetchWithTimeout(
        `${jobsUrl}/${encodeURIComponent(jobId)}`,
        { cache: 'no-store' },
        Math.min(30_000, Math.max(1, timeoutMs - (Date.now() - startedAt))),
      );
      const payload = await poll.json().catch(() => null) as LegacyJobPayload | null;
      if (!poll.ok) throw new Error(`RUNTIME_JOB_POLL_FAILED:${poll.status}:${payload?.error || 'unknown'}`);
      const status = payload?.job?.status ?? '';
      const trace = traceEntries(payload?.trace ?? payload?.job?.trace);
      input.onProgress?.({ status, runtimeJobId: jobId, threadId: payload?.thread_id ?? payload?.job?.threadId ?? null, trace });
      if (status === 'queued' || status === 'running') continue;
      if (status === 'succeeded') return legacyResponse(profile, payload?.response ?? payload?.job?.response);
      throw new Error(`RUNTIME_REQUEST_FAILED:${payload?.error || payload?.job?.error || 'Runtime job failed'}`);
    }
  }

  const response = await fetchWithTimeout(`${profile.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, Math.max(1, timeoutMs - (Date.now() - startedAt)));
  const payload = await response.json().catch(() => null) as LegacyResponse | null;
  if (!response.ok) throw new Error(`RUNTIME_REQUEST_FAILED:${response.status}:${payload?.error || 'unknown'}`);
  return legacyResponse(profile, payload);
}

export async function requestRuntimeResponse(input: RuntimeRequestInput) {
  const profile = resolveRuntimeProfile(input.runtimeKey || profileKeyFromMetadata(input.metadata));
  const sessionRuntimeKey = typeof input.metadata?.sessionRuntimeKey === 'string'
    ? input.metadata.sessionRuntimeKey.trim()
    : '';
  return requestRuntimeResponseWithProfile(profile, {
    ...input,
    continuationId: sessionRuntimeKey && sessionRuntimeKey !== profile.key ? null : input.continuationId,
  });
}

export async function requestRuntimeResponseWithProfile(
  profile: RuntimeProfileRecord,
  input: RuntimeRequestInput,
) {
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs();
  const normalized = await requestNormalized(profile, input, timeoutMs);
  return normalized ?? requestLegacy(profile, input, timeoutMs);
}
