import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import multer from 'multer';
import { loadConfig } from './config.js';
import { getDb, runMigrations } from './db.js';
import { buildTargetEnvironmentDeployPlan } from './deploy-adapters.js';
import { buildHostedSkillArchive, listHostedSkills } from './hosted-skills.js';
import { getIntegrationMeta } from './integrations.js';
import { normalizeSiteContent, readSiteContent, writeSiteContent } from './site-content.js';
import {
  applyAdminChangeRequest,
  claimCurrentProfile,
  createAdminChangeRequest,
  createAgentSession,
  createChangeRequest,
  createAuditLog,
  createSession,
  createChangeRequestExecution,
  createAgentMessage,
  createTargetApp,
  createTargetEnvironment,
  findAgentSessionByDiscordContext,
  findLatestAgentSessionByChangeRequest,
  getAdminChangeRequest,
  getAdminBadgeBySlug,
  getAgentSession,
  getAdminOverview,
  getChangeRequest,
  getCurrentActiveChangeRequest,
  getDefaultTargetEnvironmentForApp,
  getChangeRequestExecution,
  getMyPoints,
  getNextQueuedChangeRequest,
  getPrivateProfileByUserId,
  getPublicProfileByHandle,
  getSessionSummary,
  getSessionUserByTokenHash,
  getUserByEmail,
  isUserAdmin,
  listAdminHomeModules,
  listAdminChangeRequests,
  listAdminBadges,
  listAdminUsers,
  listAgentMessages,
  listAdminPointsAudit,
  listChangeRequests,
  listChangeRequestExecutions,
  listBadgesCatalog,
  listCommunityRolesCatalog,
  listHomeModulesForUser,
  listLeaderboard,
  listMembers,
  listTargetApps,
  listTargetEnvironments,
  upsertAgentSessionFromDiscord,
  getTargetApp,
  getTargetEnvironment,
  listSkillsCatalog,
  registerOrClaimUser,
  revokeSession,
  touchSession,
  updateAgentSession,
  updateHomeModules,
  updateAdminBadge,
  updateAdminChangeRequest,
  updateChangeRequest,
  updateChangeRequestExecution,
  updateProfile,
  updateUserLastSeen,
  upsertAdminBadge,
  type SessionUser,
} from './repository.js';
import { clearSessionCookie, createSessionRecord, createSessionToken, hashSessionToken, setSessionCookie } from './session.js';

const { compare, hash } = bcrypt;

const config = loadConfig();
const migrationResult = runMigrations();
const app = express();
const uploadsDir = path.resolve(config.dataRoot, 'uploads');
const avatarUploadsDir = path.join(uploadsDir, 'avatars');
const badgeUploadsDir = path.join(uploadsDir, 'badges');

fs.mkdirSync(avatarUploadsDir, { recursive: true });
fs.mkdirSync(badgeUploadsDir, { recursive: true });

function safeUploadExtension(originalName: string) {
  const extension = path.extname(originalName).toLowerCase();

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) {
    return extension;
  }

  return '.bin';
}

function buildUploadStorage(destination: string) {
  return multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, destination);
    },
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${safeUploadExtension(file.originalname)}`);
    },
  });
}

const uploadFileFilter: multer.Options['fileFilter'] = (_req, file, callback) => {
  if (file.mimetype.startsWith('image/')) {
    callback(null, true);
    return;
  }

  callback(new Error('INVALID_IMAGE_TYPE'));
};

const avatarUpload = multer({
  storage: buildUploadStorage(avatarUploadsDir),
  fileFilter: uploadFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const badgeImageUpload = multer({
  storage: buildUploadStorage(badgeUploadsDir),
  fileFilter: uploadFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const targetEnvironmentKinds = ['production', 'staging', 'preview', 'development'];
const trackedChangeRequestStatuses = [
  'submitted',
  'triaging',
  'needs-human-input',
  'ready-for-agent',
  'in-progress',
  'awaiting-review',
  'changes-requested',
  'approved',
  'rejected',
  'closed',
];
const trackedChangeRequestTypes = ['bug', 'feature', 'content', 'design', 'config', 'ops'];
const trackedChangeRequestPriorities = ['low', 'normal', 'high', 'urgent'];

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/uploads', express.static(uploadsDir));

function readSessionToken(req: express.Request) {
  const cookieValue = req.cookies?.[config.sessionCookieName];
  return typeof cookieValue === 'string' ? cookieValue : null;
}

function getRequestSessionUser(req: express.Request) {
  const token = readSessionToken(req);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const sessionUser = getSessionUserByTokenHash(tokenHash);
  if (!sessionUser) return null;

  touchSession(tokenHash);
  updateUserLastSeen(sessionUser.id);
  return sessionUser;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sessionUser = getRequestSessionUser(req);
  if (!sessionUser) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  res.locals.sessionUser = sessionUser;
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sessionUser = getRequestSessionUser(req);
  if (!sessionUser) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  if (!isUserAdmin(sessionUser.id)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }

  res.locals.sessionUser = sessionUser;
  next();
}

function readAdminPassword(req: express.Request) {
  const directHeader = req.header('x-admin-password')?.trim();
  if (directHeader) {
    return directHeader;
  }

  const authorization = req.header('authorization')?.trim();
  if (!authorization) {
    return null;
  }

  if (authorization.toLowerCase().startsWith('password ')) {
    return authorization.slice(9).trim();
  }

  return null;
}

function requireAdminSessionOrPassword(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sessionUser = getRequestSessionUser(req);
  if (sessionUser && isUserAdmin(sessionUser.id)) {
    res.locals.sessionUser = sessionUser;
    res.locals.adminAuthMode = 'session';
    next();
    return;
  }

  if (readAdminPassword(req) === config.adminPassword) {
    res.locals.adminAuthMode = 'password';
    next();
    return;
  }

  res.status(401).json({ ok: false, error: 'Unauthorized' });
}

function getOptionalSessionUser(res: express.Response) {
  return (res.locals.sessionUser as SessionUser | undefined) ?? null;
}

function getInternalServiceToken() {
  const explicitToken = process.env.INTERNAL_SERVICE_TOKEN?.trim() || process.env.SERVICE_SHARED_TOKEN?.trim();
  if (explicitToken) {
    return explicitToken;
  }

  return createHash('sha256')
    .update(`${config.adminPassword}:prism-agent-internal-service`)
    .digest('hex');
}

function readServiceToken(req: express.Request) {
  const directHeader = req.header('x-service-token')?.trim();
  if (directHeader) {
    return directHeader;
  }

  const authorization = req.header('authorization')?.trim();
  if (!authorization) {
    return null;
  }

  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return authorization;
}

function requireServiceToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (readServiceToken(req) !== getInternalServiceToken()) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  next();
}

function parseString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNullableString(value: unknown) {
  if (value === null) return null;
  return typeof value === 'string' ? value.trim() : undefined;
}

function parseOptionalLimit(value: unknown, fallback?: number) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return undefined;
}

function parseResponseInputMessages(input: unknown) {
  if (typeof input === 'string' && input.trim()) {
    return [{ role: 'user', content: input.trim() }];
  }

  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const candidate = entry as {
        role?: unknown;
        content?: unknown;
      };

      if (typeof candidate.content === 'string' && candidate.content.trim()) {
        return {
          role: typeof candidate.role === 'string' ? candidate.role.trim() || 'user' : 'user',
          content: candidate.content.trim(),
        };
      }

      if (Array.isArray(candidate.content)) {
        const joined = candidate.content
          .flatMap((part) => {
            if (!part || typeof part !== 'object') return [];
            const contentPart = part as { text?: unknown };
            return typeof contentPart.text === 'string' && contentPart.text.trim()
              ? [contentPart.text.trim()]
              : [];
          })
          .join('\n\n')
          .trim();

        if (joined) {
          return {
            role: typeof candidate.role === 'string' ? candidate.role.trim() || 'user' : 'user',
            content: joined,
          };
        }
      }

      return null;
    })
    .filter((entry): entry is { role: string; content: string } => Boolean(entry));
}

async function requestCodexRuntimeResponse(input: {
  prompt: string;
  sessionId: string;
  codexThreadId?: string | null;
  recentHistory: Array<{ role: string; content: string }>;
  metadata: Record<string, unknown>;
}) {
  if (!config.codexRuntimeBaseUrl) {
    throw new Error('CODEX_RUNTIME_BASE_URL_MISSING');
  }

  const response = await fetch(`${config.codexRuntimeBaseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: input.prompt,
      sessionId: input.sessionId,
      codexThreadId: input.codexThreadId ?? null,
      recentHistory: input.recentHistory,
      metadata: input.metadata,
    }),
  });

  const payload = await response.json().catch(() => null) as
    | {
        ok?: boolean;
        error?: string;
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
      }
    | null;

  if (!response.ok) {
    const error = new Error(
      `CODEX_RUNTIME_REQUEST_FAILED:${response.status}:${payload?.error || 'Unknown codex runtime error'}`,
    ) as Error & {
      codexThreadId?: string | null;
      branchName?: string | null;
      commitSha?: string | null;
      baseBranch?: string | null;
      baseCommitSha?: string | null;
      trace?: Array<{ at: string; kind: string; message: string }>;
    };
    error.codexThreadId = payload?.thread_id ?? null;
    error.branchName = payload?.branchName ?? null;
    error.commitSha = payload?.commitSha ?? null;
    error.baseBranch = payload?.baseBranch ?? null;
    error.baseCommitSha = payload?.baseCommitSha ?? null;
    error.trace = Array.isArray(payload?.trace)
      ? payload.trace
        .map((entry) => ({
          at: typeof entry?.at === 'string' ? entry.at : new Date().toISOString(),
          kind: typeof entry?.kind === 'string' ? entry.kind : 'runtime',
          message: typeof entry?.message === 'string' ? entry.message : '',
        }))
        .filter((entry) => entry.message.trim())
      : [];
    throw error;
  }

  return (payload ?? {}) as {
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
    trace?: Array<{ at: string; kind: string; message: string }>;
  };
}

function getLinkedChangeRequestPhase(status: string | null | undefined) {
  if (!status) {
    return null;
  }

  if (['submitted', 'triaging', 'needs-human-input'].includes(status)) {
    return 'triage' as const;
  }

  if (['ready-for-agent', 'in-progress', 'awaiting-review', 'changes-requested'].includes(status)) {
    return 'execution' as const;
  }

  return null;
}

function getRunningStatusForPhase(phase: 'triage' | 'execution') {
  return phase === 'triage' ? 'triaging' : 'in-progress';
}

function getCompletedStatusForPhase(phase: 'triage' | 'execution') {
  return phase === 'triage' ? 'ready-for-agent' : 'awaiting-review';
}

function isTriageOnlyStatus(status: string | null | undefined) {
  return ['submitted', 'triaging', 'needs-human-input'].includes(status ?? '');
}

function isExecutionStatus(status: string | null | undefined) {
  return ['in-progress', 'awaiting-review', 'changes-requested', 'approved', 'closed'].includes(status ?? '');
}

function hasActiveExecution(changeRequestId: string, excludeExecutionId?: string | null) {
  return listChangeRequestExecutions(changeRequestId).some((execution) => {
    if (excludeExecutionId && execution.id === excludeExecutionId) {
      return false;
    }

    return ['planned', 'running'].includes(execution.status);
  });
}

function getPhaseInstruction(phase: 'triage' | 'execution' | null) {
  if (phase === 'triage') {
    return 'This request is currently in triage. Use this turn only to analyze scope, write triage details, and stop after moving it to ready-for-agent. Do not start implementation, deploy work, or execution in this same turn.';
  }

  if (phase === 'execution') {
    return 'This request is already approved for agent work. Treat recent user comments as execution instructions and report what changed, what is blocked, and what should happen next.';
  }

  return null;
}

function formatTraceSummary(trace: Array<{ at: string; kind: string; message: string }> | undefined) {
  if (!Array.isArray(trace) || !trace.length) {
    return null;
  }

  return trace
    .slice(-8)
    .map((entry) => `[${entry.at}] ${entry.kind}: ${entry.message}`)
    .join('\n');
}

function summarizeGitPushState(trace: Array<{ at: string; kind: string; message: string }> | undefined) {
  if (!Array.isArray(trace) || !trace.length) {
    return {
      gitPushSucceeded: null as boolean | null,
      gitPushError: null as string | null,
    };
  }

  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const entry = trace[index];
    if (!entry || typeof entry.message !== 'string') {
      continue;
    }

    if (entry.kind === 'git.push_succeeded') {
      return {
        gitPushSucceeded: true,
        gitPushError: null,
      };
    }

    if (
      ['git.finalize_failed', 'runtime.error', 'stderr'].includes(entry.kind)
      && /git push|github|username for https:\/\/github\.com/i.test(entry.message)
    ) {
      return {
        gitPushSucceeded: false,
        gitPushError: entry.message,
      };
    }
  }

  return {
    gitPushSucceeded: null,
    gitPushError: null,
  };
}

function stringifyDiscordHistory(
  history: Array<{
    authorName: string;
    content: string;
    createdAt: string;
    isBot: boolean;
  }>,
) {
  return history
    .map((entry) => {
      const role = entry.isBot ? 'Assistant' : entry.authorName;
      return `[${entry.createdAt}] ${role}: ${entry.content}`;
    })
    .join('\n');
}

function readOpenAIResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  if (typeof candidate.output_text === 'string' && candidate.output_text.trim()) {
    return candidate.output_text.trim();
  }

  if (!Array.isArray(candidate.output)) {
    return null;
  }

  const parts = candidate.output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((item): item is { type: string; text: string } => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean);

  return parts.length ? parts.join('\n\n') : null;
}

interface DiscordChatResponseInput {
  prompt: string;
  guildId: string;
  channelId: string;
  threadId?: string | null;
  authorName: string;
  history: Array<{
    authorName: string;
    content: string;
    createdAt: string;
    isBot: boolean;
  }>;
}

interface DiscordChatResponseResult {
  model: string | null;
  provider: 'agent-endpoint';
  sessionId: string;
  text: string;
}

interface DiscordAgentAdapterInput {
  sessionId: string;
  prompt: string;
  guildId: string;
  channelId: string;
  threadId: string | null;
  authorName: string;
  history: Array<{
    authorName: string;
    content: string;
    createdAt: string;
    isBot: boolean;
  }>;
  metadata: Record<string, unknown>;
}

interface DiscordAgentAdapterResult {
  provider: string;
  model: string | null;
  responseText: string;
  sessionId: string;
}

function buildDiscordSessionId(input: DiscordChatResponseInput) {
  return `discord:${input.guildId}:${input.threadId || input.channelId}`;
}

function readJsonString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readAgentResponseText(payload: unknown): string | null {
  const openAiText = readOpenAIResponseText(payload);
  if (openAiText) {
    return openAiText;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as {
    responseText?: unknown;
    text?: unknown;
    message?: unknown;
    content?: unknown;
    answer?: unknown;
    response?: { text?: unknown; content?: unknown; message?: unknown };
    data?: { text?: unknown; content?: unknown; message?: unknown };
  };

  return readJsonString(candidate.responseText)
    || readJsonString(candidate.text)
    || readJsonString(candidate.message)
    || readJsonString(candidate.content)
    || readJsonString(candidate.answer)
    || readJsonString(candidate.response?.text)
    || readJsonString(candidate.response?.content)
    || readJsonString(candidate.response?.message)
    || readJsonString(candidate.data?.text)
    || readJsonString(candidate.data?.content)
    || readJsonString(candidate.data?.message)
    || null;
}

function readAgentResponseModel(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as {
    model?: unknown;
    response?: { model?: unknown };
    data?: { model?: unknown };
  };

  return readJsonString(candidate.model)
    || readJsonString(candidate.response?.model)
    || readJsonString(candidate.data?.model)
    || null;
}

function buildDiscordAgentMessages(input: DiscordAgentAdapterInput) {
  const historyMessages = input.history.map((entry) => ({
    role: entry.isBot ? 'assistant' : 'user',
    content: entry.content,
    authorName: entry.authorName,
    createdAt: entry.createdAt,
  }));

  return [
    ...historyMessages,
    {
      role: 'user',
      content: input.prompt,
      authorName: input.authorName,
      createdAt: new Date().toISOString(),
    },
  ];
}

async function generateCodexDiscordAgentResponse(
  input: DiscordAgentAdapterInput,
): Promise<DiscordAgentAdapterResult> {
  const payload = await requestCodexRuntimeResponse({
    prompt: input.prompt,
    sessionId: input.sessionId,
    recentHistory: buildDiscordAgentMessages(input)
      .slice(0, -1)
      .map((entry) => ({
        role: entry.role,
        content: entry.content,
      })),
    metadata: {
      ...input.metadata,
      source: 'discord',
      transport: 'discord',
      guildId: input.guildId,
      channelId: input.channelId,
      threadId: input.threadId,
      authorName: input.authorName,
    },
  });

  const responseText = readAgentResponseText(payload);
  if (!responseText) {
    throw new Error('CODEX_RUNTIME_RESPONSE_EMPTY');
  }

  return {
    provider: 'codex',
    model: readAgentResponseModel(payload),
    responseText,
    sessionId: input.sessionId,
  };
}

async function generateAgentEndpointDiscordChatResponse(
  input: DiscordChatResponseInput,
  endpoint: string,
): Promise<DiscordChatResponseResult> {
  const sessionId = buildDiscordSessionId(input);
  const timeoutMs = Number(process.env.DISCORD_AGENT_TIMEOUT_MS || 30_000);
  const authToken = process.env.DISCORD_AGENT_AUTH_TOKEN?.trim()
    || process.env.AGENT_CHAT_AUTH_TOKEN?.trim()
    || getInternalServiceToken();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      source: 'discord',
      sessionId,
      prompt: input.prompt,
      guildId: input.guildId,
      channelId: input.channelId,
      threadId: input.threadId ?? null,
      author: {
        displayName: input.authorName,
      },
      history: input.history,
      metadata: {
        transport: 'discord',
        sessionKeyType: input.threadId ? 'thread' : 'channel',
      },
    }),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? Math.max(1_000, timeoutMs) : 30_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`AGENT_ENDPOINT_FAILED:${response.status}:${errorText.slice(0, 200)}`);
  }

  const payload = await response.json().catch(() => null);
  const text = readAgentResponseText(payload);
  if (!text) {
    throw new Error('AGENT_ENDPOINT_EMPTY');
  }

  const model = payload && typeof payload === 'object'
    ? readAgentResponseModel(payload)
    : null;

  return {
    model,
    provider: 'agent-endpoint',
    sessionId,
    text,
  };
}

async function generateDiscordChatResponse(input: DiscordChatResponseInput): Promise<DiscordChatResponseResult> {
  const endpoint = process.env.DISCORD_AGENT_ENDPOINT?.trim()
    || process.env.AGENT_CHAT_ENDPOINT?.trim()
    || `http://127.0.0.1:${config.port}/api/internal/agents/discord/codex`;

  return generateAgentEndpointDiscordChatResponse(input, endpoint);
}

interface ParsedHomeModuleUpdate {
  id: string;
  enabled?: boolean;
  displayOrder?: number;
  visibilityRole?: string | null;
  config?: Record<string, unknown>;
}

function parseHomeModuleUpdate(value: unknown): ParsedHomeModuleUpdate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = parseString(candidate.id);
  if (!id) {
    return null;
  }

  return {
    id,
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : undefined,
    displayOrder: parseOptionalInteger(candidate.displayOrder),
    visibilityRole: candidate.visibilityRole === null ? null : parseNullableString(candidate.visibilityRole),
    config:
      candidate.config && typeof candidate.config === 'object' && !Array.isArray(candidate.config)
        ? candidate.config as Record<string, unknown>
        : undefined,
  };
}

function slugifyValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    seen.add(trimmed);
  }

  return [...seen];
}

function normalizeAdminChangeRequestPayload(requestType: string, value: unknown) {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  if (requestType === 'points_adjustment') {
    const userIds = readStringArray(payload.userIds);
    const delta = Number(payload.delta);
    const reason = parseString(payload.reason);

    if (!userIds.length) {
      throw new Error('NO_TARGET_USERS');
    }

    if (!Number.isInteger(delta) || delta === 0) {
      throw new Error('INVALID_POINTS_DELTA');
    }

    if (!reason) {
      throw new Error('CHANGE_REQUEST_REASON_REQUIRED');
    }

    return { userIds, delta, reason };
  }

  if (requestType === 'badge_create') {
    const badge = payload.badge && typeof payload.badge === 'object' && !Array.isArray(payload.badge)
      ? payload.badge as Record<string, unknown>
      : {};
    const slug = parseString(badge.slug);
    const label = parseString(badge.label);
    const description = parseString(badge.description);
    const imageUrl = parseString(badge.imageUrl || badge.image_url);

    if (!slug && !label) {
      throw new Error('BADGE_DETAILS_REQUIRED');
    }

    return {
      badge: {
        ...(slug ? { slug } : {}),
        ...(label ? { label } : {}),
        ...(description ? { description } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      },
    };
  }

  if (requestType === 'badge_award') {
    const userIds = readStringArray(payload.userIds);
    const reason = parseString(payload.reason);
    const badgeSlug = parseString(payload.badgeSlug || payload.badge_slug);
    const badgeLabel = parseString(payload.badgeLabel || payload.badge_label);

    if (!badgeSlug) {
      throw new Error('BADGE_SELECTION_REQUIRED');
    }

    if (!userIds.length) {
      throw new Error('NO_TARGET_USERS');
    }

    if (!reason) {
      throw new Error('CHANGE_REQUEST_REASON_REQUIRED');
    }

    return {
      userIds,
      reason,
      badgeSlug,
      ...(badgeLabel ? { badgeLabel } : {}),
    };
  }

  if (requestType === 'badge_request') {
    const badge = payload.badge && typeof payload.badge === 'object' && !Array.isArray(payload.badge)
      ? payload.badge as Record<string, unknown>
      : {};
    const userIds = readStringArray(payload.userIds);
    const reason = parseString(payload.reason);
    const slug = parseString(badge.slug);
    const label = parseString(badge.label);
    const description = parseString(badge.description);
    const imageUrl = parseString(badge.imageUrl || badge.image_url);

    if (!slug && !label) {
      throw new Error('BADGE_DETAILS_REQUIRED');
    }

    if (userIds.length && !reason) {
      throw new Error('CHANGE_REQUEST_REASON_REQUIRED');
    }

    return {
      userIds,
      reason,
      badge: {
        ...(slug ? { slug } : {}),
        ...(label ? { label } : {}),
        ...(description ? { description } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      },
    };
  }

  if (requestType === 'site_content_update') {
    const siteContent = payload.siteContent ?? payload;

    if (!siteContent || typeof siteContent !== 'object' || Array.isArray(siteContent)) {
      throw new Error('SITE_CONTENT_REQUIRED');
    }

    return {
      siteContent: normalizeSiteContent(siteContent),
    };
  }

  return payload;
}

function readRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function requireSessionUser(res: express.Response): SessionUser {
  return res.locals.sessionUser as SessionUser;
}

function toUploadUrl(...segments: string[]) {
  return `/api/uploads/${segments.join('/').replace(/\\/g, '/')}`;
}

app.get('/api/health', (_req, res) => {
  const dbRow = getDb().prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number };

  res.json({
    ok: true,
    service: 'prism-agent',
    authMode: 'opaque-cookie-session',
    appliedMigrations: dbRow.count,
    startupMigrations: migrationResult.executed,
  });
});

app.post('/api/internal/discord/chat-response', requireServiceToken, async (req, res) => {
  const prompt = parseString(req.body?.prompt ?? req.body?.chatInput);
  const guildId = parseString(req.body?.guildId ?? req.body?.guild_id);
  const channelId = parseString(req.body?.channelId ?? req.body?.channel_id);
  const threadId = parseNullableString(req.body?.threadId ?? req.body?.thread_id) ?? null;
  const authorName = parseString(req.body?.authorName ?? req.body?.author?.displayName ?? req.body?.author?.username);
  const rawHistory: unknown[] = Array.isArray(req.body?.history) ? req.body.history : [];
  const history = rawHistory
    .filter((entry: unknown): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      authorName: parseString(entry.authorName ?? entry.author_name ?? entry.author ?? 'User') || 'User',
      content: parseString(entry.content),
      createdAt: parseString(entry.createdAt ?? entry.created_at) || new Date().toISOString(),
      isBot: entry.isBot === true || entry.is_bot === true,
    }))
    .filter((entry: { content: string }) => entry.content);

  if (!prompt || !guildId || !channelId) {
    res.status(400).json({ ok: false, error: 'prompt, guildId, and channelId are required' });
    return;
  }

  try {
    const responsePayload = await generateDiscordChatResponse({
      prompt,
      guildId,
      channelId,
      threadId,
      authorName: authorName || 'User',
      history,
    });

    res.json({
      ok: true,
      model: responsePayload.model,
      provider: responsePayload.provider,
      responseText: responsePayload.text,
      sessionId: responsePayload.sessionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CHAT_RESPONSE_FAILED';
    const statusCode = message === 'CODEX_RUNTIME_BASE_URL_MISSING' ? 503 : 502;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.get('/api/internal/agent-sessions/:sessionId', requireServiceToken, (req, res) => {
  const sessionId = readRouteParam(req.params.sessionId);
  const session = getAgentSession(sessionId);

  if (!session) {
    res.status(404).json({ ok: false, error: 'Agent session not found' });
    return;
  }

  const limit = parseOptionalInteger(req.query.limit) ?? 100;
  res.json({ ok: true, session, messages: listAgentMessages(sessionId, limit) });
});

app.post('/api/internal/agent-sessions/discord/upsert', requireServiceToken, (req, res) => {
  const source = parseString(req.body?.source) || 'discord';
  const session = upsertAgentSessionFromDiscord({
    source,
    status: parseString(req.body?.status) || undefined,
    title: parseNullableString(req.body?.title) ?? undefined,
    discordGuildId: parseNullableString(req.body?.discordGuildId || req.body?.discord_guild_id) ?? undefined,
    discordChannelId: parseNullableString(req.body?.discordChannelId || req.body?.discord_channel_id) ?? undefined,
    discordThreadId: parseNullableString(req.body?.discordThreadId || req.body?.discord_thread_id) ?? undefined,
    linkedChangeRequestId:
      parseNullableString(req.body?.linkedChangeRequestId || req.body?.linked_change_request_id) ?? undefined,
    linkedTargetEnvironmentId:
      parseNullableString(req.body?.linkedTargetEnvironmentId || req.body?.linked_target_environment_id) ?? undefined,
    meta: req.body?.meta && typeof req.body.meta === 'object' && !Array.isArray(req.body.meta) ? req.body.meta : {},
    createdByUserId: parseNullableString(req.body?.createdByUserId || req.body?.created_by_user_id) ?? undefined,
    lastMessageAt: parseNullableString(req.body?.lastMessageAt || req.body?.last_message_at) ?? undefined,
  });

  res.status(201).json({ ok: true, session });
});

app.get('/api/internal/agent-sessions/discord/lookup', requireServiceToken, (req, res) => {
  const session = findAgentSessionByDiscordContext({
    discordThreadId: parseNullableString(req.query.threadId || req.query.thread_id) ?? undefined,
    discordChannelId: parseNullableString(req.query.channelId || req.query.channel_id) ?? undefined,
  });

  if (!session) {
    res.status(404).json({ ok: false, error: 'Agent session not found' });
    return;
  }

  const limit = parseOptionalInteger(req.query.limit) ?? 100;
  res.json({ ok: true, session, messages: listAgentMessages(session.id, limit) });
});

app.post('/api/internal/agent-sessions/:sessionId/messages', requireServiceToken, (req, res) => {
  const sessionId = readRouteParam(req.params.sessionId);
  const role = parseString(req.body?.role);
  const source = parseString(req.body?.source) || 'discord';
  const content = parseString(req.body?.content);

  if (!role || !content) {
    res.status(400).json({ ok: false, error: 'role and content are required' });
    return;
  }

  const message = createAgentMessage({
    sessionId,
    role,
    source,
    sourceMessageId: parseNullableString(req.body?.sourceMessageId || req.body?.source_message_id) ?? null,
    content,
    meta: req.body?.meta && typeof req.body.meta === 'object' && !Array.isArray(req.body.meta) ? req.body.meta : {},
    createdAt: parseNullableString(req.body?.createdAt || req.body?.created_at) ?? null,
  });

  if (!message) {
    res.status(404).json({ ok: false, error: 'Agent session not found' });
    return;
  }

  res.status(201).json({ ok: true, message });
});

app.post('/api/v1/responses', requireAdminSessionOrPassword, async (req, res) => {
  const sessionId = parseNullableString(req.body?.session_id ?? req.body?.sessionId) ?? null;
  const linkedChangeRequestId =
    parseNullableString(req.body?.linked_change_request_id ?? req.body?.linkedChangeRequestId) ?? null;
  const linkedTargetEnvironmentId =
    parseNullableString(req.body?.linked_target_environment_id ?? req.body?.linkedTargetEnvironmentId) ?? null;
  const inputMessages = parseResponseInputMessages(req.body?.input);
  const latestUserMessage = [...inputMessages].reverse().find((entry) => entry.role === 'user') ?? null;

  if (!latestUserMessage) {
    res.status(400).json({ ok: false, error: 'input must include at least one user message' });
    return;
  }

  const sessionUser = getOptionalSessionUser(res);
  let session = sessionId ? getAgentSession(sessionId) : null;

  if (!session && sessionId) {
    res.status(404).json({ ok: false, error: 'Agent session not found' });
    return;
  }

  if (!session) {
    session = createAgentSession({
      source: 'admin-console',
      status: 'active',
      title: latestUserMessage.content.slice(0, 80),
      linkedChangeRequestId,
      linkedTargetEnvironmentId,
      createdByUserId: sessionUser?.id ?? null,
      meta: {
        transport: 'site',
      },
      lastMessageAt: new Date().toISOString(),
    });
  }

  if (!session) {
    res.status(500).json({ ok: false, error: 'AGENT_SESSION_CREATE_FAILED' });
    return;
  }

  const storedMessages = listAgentMessages(session.id, 100);
  const recentHistory = storedMessages.length
    ? storedMessages.slice(-12).map((entry) => ({
      role: entry.role,
      content: entry.content,
    }))
    : inputMessages.slice(0, -1);
  const activeLinkedChangeRequestId = linkedChangeRequestId ?? session.linkedChangeRequestId ?? null;
  const activeLinkedTargetEnvironmentId = linkedTargetEnvironmentId ?? session.linkedTargetEnvironmentId ?? null;
  const linkedChangeRequest = activeLinkedChangeRequestId ? getChangeRequest(activeLinkedChangeRequestId) : null;
  const linkedTargetApp = linkedChangeRequest ? getTargetApp(linkedChangeRequest.targetAppId) : null;
  const linkedTargetEnvironment = activeLinkedTargetEnvironmentId
    ? getTargetEnvironment(activeLinkedTargetEnvironmentId)
    : linkedChangeRequest?.targetEnvironmentId
      ? getTargetEnvironment(linkedChangeRequest.targetEnvironmentId)
      : null;
  const linkedDeployPlan = linkedChangeRequest && linkedTargetApp && linkedTargetEnvironment
    ? buildTargetEnvironmentDeployPlan({
        request: linkedChangeRequest,
        targetApp: linkedTargetApp,
        targetEnvironment: linkedTargetEnvironment,
      })
    : null;
  const linkedLatestExecution = activeLinkedChangeRequestId
    ? listChangeRequestExecutions(activeLinkedChangeRequestId)[0] ?? null
    : null;
  const requestedSkillsInput = Array.isArray(req.body?.requested_skills ?? req.body?.requestedSkills)
    ? (req.body?.requested_skills ?? req.body?.requestedSkills)
    : [];
  const requestedSkills = Array.from(
    new Set([
      ...requestedSkillsInput
        .filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry: string) => entry.trim()),
      ...(activeLinkedChangeRequestId ? ['change-request-ops', 'target-deploy-ops'] : []),
    ]),
  );

  createAgentMessage({
    sessionId: session.id,
    role: 'user',
    source: 'site',
    sourceMessageId: null,
    content: latestUserMessage.content,
    meta: {
      transport: 'site',
    },
  });

  const linkedRequestPhase = getLinkedChangeRequestPhase(linkedChangeRequest?.status ?? null);
  const requestStartedFromStatus = linkedChangeRequest?.status ?? null;
  const requestRunningStatus = linkedRequestPhase ? getRunningStatusForPhase(linkedRequestPhase) : null;
  const linkedChangeRequestPhaseInstruction = getPhaseInstruction(linkedRequestPhase);
  let activeExecutionId: string | null = null;
  let activeExecutionCreatedAt: string | null = null;

  if (activeLinkedChangeRequestId && linkedChangeRequest && linkedRequestPhase && requestRunningStatus) {
    if (linkedRequestPhase === 'execution' && hasActiveExecution(activeLinkedChangeRequestId)) {
      res.status(409).json({ ok: false, error: 'CHANGE_REQUEST_EXECUTION_ALREADY_RUNNING' });
      return;
    }

    if (linkedChangeRequest.status !== requestRunningStatus) {
      updateChangeRequest(activeLinkedChangeRequestId, {
        status: requestRunningStatus,
      });
    }

    const execution = createChangeRequestExecution({
      changeRequestId: activeLinkedChangeRequestId,
      targetEnvironmentId: activeLinkedTargetEnvironmentId ?? linkedChangeRequest.targetEnvironmentId,
      status: 'running',
      actorType: 'codex',
      startedAt: new Date().toISOString(),
      meta: {
        phase: linkedRequestPhase,
        transport: 'site',
        sessionId: session.id,
        startedFromStatus: requestStartedFromStatus,
      },
    });
    activeExecutionId = execution?.id ?? null;
    activeExecutionCreatedAt = execution?.createdAt ?? null;
  }

  try {
    const runtimeResponse = await requestCodexRuntimeResponse({
      prompt: latestUserMessage.content,
      sessionId: session.id,
      codexThreadId:
        typeof session.meta?.codexThreadId === 'string'
          ? session.meta.codexThreadId
          : null,
      recentHistory,
      metadata: {
        transport: 'site',
        requestedSkills,
        linkedChangeRequestId: activeLinkedChangeRequestId,
        linkedTargetEnvironmentId: activeLinkedTargetEnvironmentId,
        linkedTargetApp: linkedTargetApp,
        linkedTargetEnvironment,
        linkedDeployPlan,
        linkedLatestExecution: linkedLatestExecution
          ? {
              id: linkedLatestExecution.id,
              branchName: linkedLatestExecution.branchName,
              commitSha: linkedLatestExecution.commitSha,
              meta: linkedLatestExecution.meta,
            }
          : null,
        linkedChangeRequest: linkedChangeRequest
          ? {
              id: linkedChangeRequest.id,
              requestNumber: linkedChangeRequest.requestNumber,
              title: linkedChangeRequest.title,
              status: linkedChangeRequest.status,
              triageSummary: linkedChangeRequest.triageSummary,
              agentRecommendation: linkedChangeRequest.agentRecommendation,
              reviewNotes: linkedChangeRequest.reviewNotes,
            }
          : null,
        linkedChangeRequestInstruction: activeLinkedChangeRequestId
          ? linkedChangeRequestPhaseInstruction
            ?? 'This response is linked to a tracked change request. Treat recent user comments as instructions on that request. If you continue work, explain what changed or what blocked you.'
          : null,
      },
    });

    const responseText = (
      runtimeResponse.responseText
      || runtimeResponse.output_text
      || ''
    ).trim();

    if (!responseText) {
      res.status(502).json({ ok: false, error: 'CODEX_RUNTIME_EMPTY_RESPONSE' });
      return;
    }

    const updatedSession = updateAgentSession(session.id, {
      title: session.title ?? latestUserMessage.content.slice(0, 80),
      linkedChangeRequestId: activeLinkedChangeRequestId,
      linkedTargetEnvironmentId: activeLinkedTargetEnvironmentId,
      meta: {
        ...session.meta,
        transport: 'site',
        codexThreadId: runtimeResponse.thread_id ?? session.meta?.codexThreadId ?? null,
        codexProvider: runtimeResponse.provider ?? 'codex-cli',
      },
      lastMessageAt: new Date().toISOString(),
    });

    const assistantMessage = createAgentMessage({
      sessionId: session.id,
      role: 'assistant',
      source: 'site',
      sourceMessageId: null,
      content: responseText,
      meta: {
        transport: 'site',
        codexThreadId: runtimeResponse.thread_id ?? null,
      },
    });

    if (activeExecutionId) {
      const traceSummary = formatTraceSummary(runtimeResponse.trace);
      const gitPushState = summarizeGitPushState(runtimeResponse.trace);
      updateChangeRequestExecution(activeExecutionId, {
        status: 'completed',
        branchName: runtimeResponse.branchName ?? null,
        commitSha: runtimeResponse.commitSha ?? null,
        summary: traceSummary ?? responseText.slice(0, 1200),
        finishedAt: new Date().toISOString(),
        meta: {
          phase: linkedRequestPhase,
          transport: 'site',
          sessionId: session.id,
          startedFromStatus: requestStartedFromStatus,
          codexThreadId: runtimeResponse.thread_id ?? null,
          baseBranch: runtimeResponse.baseBranch ?? null,
          baseCommitSha: runtimeResponse.baseCommitSha ?? null,
          headCommitSha: runtimeResponse.commitSha ?? null,
          branchUrl: runtimeResponse.branchUrl ?? null,
          gitPushSucceeded: gitPushState.gitPushSucceeded,
          gitPushError: gitPushState.gitPushError,
          runtimeTrace: Array.isArray(runtimeResponse.trace) ? runtimeResponse.trace : [],
        },
      });
    }

    if (activeLinkedChangeRequestId && linkedRequestPhase) {
      if (linkedRequestPhase === 'triage') {
        const strayExecutions = listChangeRequestExecutions(activeLinkedChangeRequestId).filter((execution) => {
          if (execution.id === activeExecutionId) {
            return false;
          }

          if (!['planned', 'running'].includes(execution.status)) {
            return false;
          }

          if (!activeExecutionCreatedAt) {
            return true;
          }

          return execution.createdAt >= activeExecutionCreatedAt;
        });

        for (const execution of strayExecutions) {
          updateChangeRequestExecution(execution.id, {
            status: 'failed',
            errorMessage: 'Execution was started during a triage-only turn and has been suppressed.',
            summary: 'Suppressed execution created before admin review.',
            finishedAt: new Date().toISOString(),
          });
        }

        updateChangeRequest(activeLinkedChangeRequestId, {
          status: 'ready-for-agent',
        });
      } else if (requestRunningStatus) {
        const refreshedChangeRequest = getChangeRequest(activeLinkedChangeRequestId);
        if (refreshedChangeRequest?.status === requestRunningStatus) {
          updateChangeRequest(activeLinkedChangeRequestId, {
            status: getCompletedStatusForPhase(linkedRequestPhase),
          });
        }
      }
    }

    res.json({
      id: assistantMessage?.id ?? randomUUID(),
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model: runtimeResponse.model ?? 'codex-runtime',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: responseText,
            },
          ],
        },
      ],
      output_text: responseText,
      session_id: updatedSession?.id ?? session.id,
      metadata: {
        codex_thread_id: runtimeResponse.thread_id ?? null,
        trace: Array.isArray(runtimeResponse.trace) ? runtimeResponse.trace : [],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CODEX_RUNTIME_REQUEST_FAILED';
    const failedAt = new Date().toISOString();
    const runtimeError = error as Error & {
      codexThreadId?: string | null;
      branchName?: string | null;
      commitSha?: string | null;
      baseBranch?: string | null;
      baseCommitSha?: string | null;
      trace?: Array<{ at: string; kind: string; message: string }>;
    };
    const failureTrace = Array.isArray(runtimeError.trace) ? runtimeError.trace : [];
    const failureSummary = formatTraceSummary(failureTrace);

    if (activeLinkedChangeRequestId && linkedChangeRequest && linkedRequestPhase && requestRunningStatus) {
      if (activeExecutionId) {
        updateChangeRequestExecution(activeExecutionId, {
          status: 'failed',
          branchName:
            typeof runtimeError.branchName === 'string'
              ? runtimeError.branchName
              : linkedLatestExecution?.branchName ?? null,
          commitSha:
            typeof runtimeError.commitSha === 'string'
              ? runtimeError.commitSha
              : linkedLatestExecution?.commitSha ?? null,
          errorMessage: message,
          summary: failureSummary,
          finishedAt: failedAt,
          meta: {
            phase: linkedRequestPhase,
            transport: 'site',
            sessionId: session.id,
            startedFromStatus: requestStartedFromStatus,
            codexThreadId: runtimeError.codexThreadId ?? null,
            baseBranch:
              typeof runtimeError.baseBranch === 'string'
                ? runtimeError.baseBranch
                : (linkedLatestExecution?.meta?.baseBranch as string | undefined) ?? null,
            baseCommitSha:
              typeof runtimeError.baseCommitSha === 'string'
                ? runtimeError.baseCommitSha
                : (linkedLatestExecution?.meta?.baseCommitSha as string | undefined) ?? null,
            headCommitSha:
              typeof runtimeError.commitSha === 'string'
                ? runtimeError.commitSha
                : linkedLatestExecution?.commitSha ?? null,
            runtimeTrace: failureTrace,
          },
        });
      }

      if (linkedRequestPhase === 'triage') {
        updateChangeRequest(activeLinkedChangeRequestId, {
          status: requestStartedFromStatus ?? 'submitted',
        });
      } else {
        const refreshedChangeRequest = getChangeRequest(activeLinkedChangeRequestId);
        if (refreshedChangeRequest?.status === requestRunningStatus) {
          updateChangeRequest(activeLinkedChangeRequestId, {
            status: requestStartedFromStatus ?? 'ready-for-agent',
          });
        }
      }
    }

    createAgentMessage({
      sessionId: session.id,
      role: 'assistant',
      source: 'site',
      sourceMessageId: null,
      content: failureSummary ? `Run failed: ${message}\n\nRecent execution trace:\n${failureSummary}` : `Run failed: ${message}`,
      meta: {
        transport: 'site',
        error: true,
        runtimeTrace: failureTrace,
      },
    });
    updateAgentSession(session.id, {
      linkedChangeRequestId: activeLinkedChangeRequestId,
      linkedTargetEnvironmentId: activeLinkedTargetEnvironmentId,
      lastMessageAt: new Date().toISOString(),
      meta: {
        ...session.meta,
        transport: 'site',
      },
    });
    res.status(502).json({ ok: false, error: message });
  }
});

app.post('/api/internal/agents/discord/codex', requireServiceToken, async (req, res) => {
  const prompt = parseString(req.body?.prompt ?? req.body?.message ?? req.body?.input);
  const sessionId = parseString(req.body?.sessionId);
  const guildId = parseString(req.body?.guildId ?? req.body?.context?.guildId ?? req.body?.metadata?.guildId);
  const channelId = parseString(req.body?.channelId ?? req.body?.context?.channelId ?? req.body?.metadata?.channelId);
  const threadId = parseNullableString(
    req.body?.threadId
      ?? req.body?.context?.threadId
      ?? req.body?.metadata?.threadId,
  ) ?? null;
  const authorName = parseString(req.body?.author?.displayName ?? req.body?.authorName ?? req.body?.author?.username) || 'User';
  const rawHistory: unknown[] = Array.isArray(req.body?.history) ? req.body.history : [];
  const history = rawHistory
    .filter((entry: unknown): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      authorName: parseString(entry.authorName ?? entry.author_name ?? entry.author ?? 'User') || 'User',
      content: parseString(entry.content),
      createdAt: parseString(entry.createdAt ?? entry.created_at) || new Date().toISOString(),
      isBot: entry.isBot === true || entry.is_bot === true,
    }))
    .filter((entry: { content: string }) => entry.content);

  if (!prompt || !sessionId || !guildId || !channelId) {
    res.status(400).json({ ok: false, error: 'sessionId, prompt, guildId, and channelId are required' });
    return;
  }

  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
    ? req.body.metadata as Record<string, unknown>
    : {};

  try {
    const responsePayload = await generateCodexDiscordAgentResponse({
      sessionId,
      prompt,
      guildId,
      channelId,
      threadId,
      authorName,
      history,
      metadata,
    });

    res.json({
      ok: true,
      provider: responsePayload.provider,
      model: responsePayload.model,
      responseText: responsePayload.responseText,
      sessionId: responsePayload.sessionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CODEX_RUNTIME_ADAPTER_FAILED';
    const statusCode = message === 'CODEX_RUNTIME_BASE_URL_MISSING' ? 503 : 502;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.get('/api/integrations/meta', (_req, res) => {
  res.json({ ok: true, integrations: getIntegrationMeta(config) });
});

app.get('/api/site-content', (_req, res) => {
  res.json({ ok: true, siteContent: readSiteContent(config) });
});

app.get('/api/auth/me', (req, res) => {
  const sessionUser = getRequestSessionUser(req);
  res.json({ ok: true, user: sessionUser });
});

app.post('/api/auth/register', async (req, res) => {
  const email = parseString(req.body?.email).toLowerCase();
  const password = parseString(req.body?.password);
  const handle = parseString(req.body?.handle);
  const displayName = parseString(req.body?.displayName || req.body?.display_name);

  if (!email || !password || !handle || !displayName) {
    res.status(400).json({ ok: false, error: 'email, password, handle, and displayName are required' });
    return;
  }

  try {
    const passwordHash = await hash(password, 10);
    const user = registerOrClaimUser({ email, passwordHash, handle, displayName });
    if (!user) {
      throw new Error('REGISTER_FAILED');
    }

    const rawSessionToken = createSessionToken();
    const sessionRecord = createSessionRecord(config, user.id, hashSessionToken(rawSessionToken));
    createSession(sessionRecord);
    setSessionCookie(res, config, rawSessionToken);
    createAuditLog({
      actorUserId: user.id,
      actionType: 'auth.register',
      targetType: 'user',
      targetId: user.id,
      meta: { email: user.email, handle: user.handle },
    });

    res.status(201).json({ ok: true, user });
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_IN_USE') {
      res.status(409).json({ ok: false, error: 'Email is already registered' });
      return;
    }

    if (error instanceof Error && error.message === 'HANDLE_TAKEN') {
      res.status(409).json({ ok: false, error: 'Handle is already taken' });
      return;
    }

    if (error instanceof Error && error.message === 'SEED_EMAIL_MISMATCH') {
      res.status(409).json({ ok: false, error: 'Seeded profile email does not match the registration email' });
      return;
    }

    res.status(500).json({ ok: false, error: 'Unable to register user' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = parseString(req.body?.email).toLowerCase();
  const password = parseString(req.body?.password);

  if (!email || !password) {
    res.status(400).json({ ok: false, error: 'email and password are required' });
    return;
  }

  const user = getUserByEmail(email);
  if (!user || !user.password_hash || user.is_banned) {
    res.status(401).json({ ok: false, error: 'Invalid credentials' });
    return;
  }

  const passwordMatches = await compare(password, user.password_hash);
  if (!passwordMatches) {
    res.status(401).json({ ok: false, error: 'Invalid credentials' });
    return;
  }

  const rawSessionToken = createSessionToken();
  const sessionRecord = createSessionRecord(config, user.id, hashSessionToken(rawSessionToken));
  createSession(sessionRecord);
  setSessionCookie(res, config, rawSessionToken);

  const sessionUser = getSessionSummary(user.id);
  createAuditLog({
    actorUserId: user.id,
    actionType: 'auth.login',
    targetType: 'user',
    targetId: user.id,
  });

  res.json({ ok: true, user: sessionUser });
});

app.post('/api/auth/logout', (req, res) => {
  const token = readSessionToken(req);
  if (token) {
    revokeSession(hashSessionToken(token));
  }

  clearSessionCookie(res, config);
  res.json({ ok: true });
});

app.post('/api/profile/me/avatar', requireAuth, avatarUpload.single('file'), (req, res) => {
  const sessionUser = requireSessionUser(res);

  if (!req.file) {
    res.status(400).json({ ok: false, error: 'Image file is required' });
    return;
  }

  const avatarUrl = toUploadUrl('avatars', req.file.filename);
  const profile = updateProfile(sessionUser.id, { avatarUrl });

  createAuditLog({
    actorUserId: sessionUser.id,
    actionType: 'profile.avatar.upload',
    targetType: 'profile',
    targetId: profile?.id ?? null,
    meta: {
      avatarUrl,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    },
  });

  res.status(201).json({ ok: true, avatarUrl, profile });
});

app.get('/api/profile/me', requireAuth, (_req, res) => {
  const sessionUser = requireSessionUser(res);
  const profile = getPrivateProfileByUserId(sessionUser.id);
  res.json({ ok: true, profile });
});

app.put('/api/profile/me', requireAuth, (req, res) => {
  const sessionUser = requireSessionUser(res);

  try {
    const profile = updateProfile(sessionUser.id, {
      handle: typeof req.body?.handle === 'string' ? req.body.handle : undefined,
      displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : undefined,
      bio: typeof req.body?.bio === 'string' || req.body?.bio === null ? req.body.bio : undefined,
      avatarUrl:
        typeof req.body?.avatarUrl === 'string' || req.body?.avatarUrl === null ? req.body.avatarUrl : undefined,
      walletAddress:
        typeof req.body?.walletAddress === 'string' || req.body?.walletAddress === null
          ? req.body.walletAddress
          : undefined,
      location:
        typeof req.body?.location === 'string' || req.body?.location === null ? req.body.location : undefined,
      links: Array.isArray(req.body?.links) ? req.body.links : undefined,
      contact:
        req.body?.contact && typeof req.body.contact === 'object' && !Array.isArray(req.body.contact)
          ? req.body.contact
          : undefined,
      skillSlugs: Array.isArray(req.body?.skillSlugs) ? req.body.skillSlugs : undefined,
      communityRoleSlugs: Array.isArray(req.body?.communityRoleSlugs) ? req.body.communityRoleSlugs : undefined,
      visibility: typeof req.body?.visibility === 'string' ? req.body.visibility : undefined,
      visibilitySettings:
        req.body?.visibilitySettings
        && typeof req.body.visibilitySettings === 'object'
        && !Array.isArray(req.body.visibilitySettings)
          ? req.body.visibilitySettings
          : undefined,
    });

    if (!profile) {
      res.status(404).json({ ok: false, error: 'Profile not found' });
      return;
    }

    createAuditLog({
      actorUserId: sessionUser.id,
      actionType: 'profile.update',
      targetType: 'profile',
      targetId: profile.id,
    });
    res.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof Error && error.message === 'HANDLE_TAKEN') {
      res.status(409).json({ ok: false, error: 'Handle is already taken' });
      return;
    }

    res.status(500).json({ ok: false, error: 'Unable to update profile' });
  }
});

app.post('/api/profile/me/claim', requireAuth, (_req, res) => {
  const sessionUser = requireSessionUser(res);
  const profile = claimCurrentProfile(sessionUser.id);
  createAuditLog({
    actorUserId: sessionUser.id,
    actionType: 'profile.claim',
    targetType: 'profile',
    targetId: profile?.id ?? null,
  });
  res.json({ ok: true, profile });
});

app.get('/api/profiles/:handle', (req, res) => {
  const sessionUser = getRequestSessionUser(req);
  const profile = getPublicProfileByHandle(req.params.handle, sessionUser?.id);

  if (!profile) {
    res.status(404).json({ ok: false, error: 'Profile not found' });
    return;
  }

  res.json({ ok: true, profile });
});

app.get('/api/members', (req, res) => {
  const sessionUser = getRequestSessionUser(req);
  const members = listMembers({
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    skill: typeof req.query.skill === 'string' ? req.query.skill : undefined,
    communityRole: typeof req.query.communityRole === 'string' ? req.query.communityRole : undefined,
    limit: parseOptionalLimit(req.query.limit),
  }, sessionUser?.id);

  res.json({ ok: true, members });
});

app.get('/api/points/me', requireAuth, (_req, res) => {
  const sessionUser = requireSessionUser(res);
  res.json({ ok: true, points: getMyPoints(sessionUser.id) });
});

app.get('/api/points/leaderboard', (req, res) => {
  const sessionUser = getRequestSessionUser(req);
  const limit = parseOptionalLimit(req.query.limit, 25) ?? 25;
  res.json({ ok: true, leaderboard: listLeaderboard(limit, sessionUser?.id) });
});

app.get('/api/home-modules', requireAuth, (_req, res) => {
  const sessionUser = requireSessionUser(res);
  res.json({ ok: true, modules: listHomeModulesForUser(sessionUser.id) });
});

app.get('/api/taxonomy/skills', (_req, res) => {
  res.json({ ok: true, skills: listSkillsCatalog() });
});

app.get('/api/taxonomy/community-roles', (_req, res) => {
  res.json({ ok: true, communityRoles: listCommunityRolesCatalog() });
});

app.get('/api/taxonomy/badges', (_req, res) => {
  res.json({ ok: true, badges: listBadgesCatalog() });
});

app.get('/api/admin/overview', requireAdmin, (_req, res) => {
  res.json({ ok: true, overview: getAdminOverview() });
});

app.get('/api/admin/home-modules', requireAdmin, (_req, res) => {
  res.json({ ok: true, modules: listAdminHomeModules() });
});

app.put('/api/admin/home-modules', requireAdmin, (req, res) => {
  const sessionUser = requireSessionUser(res);
  const incomingModules = Array.isArray(req.body?.modules)
    ? req.body.modules
    : Array.isArray(req.body)
      ? req.body
      : null;

  if (!incomingModules) {
    res.status(400).json({ ok: false, error: 'A modules array is required' });
    return;
  }

  const updates: ParsedHomeModuleUpdate[] = [];

  for (const item of incomingModules as unknown[]) {
    const parsed = parseHomeModuleUpdate(item);
    if (parsed) {
      updates.push(parsed);
    }
  }

  if (!updates.length) {
    res.status(400).json({ ok: false, error: 'At least one valid module update is required' });
    return;
  }

  const modules = updateHomeModules(updates);

  createAuditLog({
    actorUserId: sessionUser.id,
    actionType: 'admin.home_modules.update',
    targetType: 'home_module',
    targetId: 'home-modules',
    meta: {
      moduleIds: updates.map((module) => module.id),
      updatedCount: updates.length,
    },
  });

  res.json({ ok: true, modules });
});

app.put('/api/admin/site-content', requireAdmin, (req, res) => {
  const sessionUser = requireSessionUser(res);
  const siteContent = writeSiteContent(config, req.body?.siteContent ?? req.body);

  createAuditLog({
    actorUserId: sessionUser.id,
    actionType: 'admin.site_content.update',
    targetType: 'site_content',
    targetId: 'site-content',
    meta: {
      navigation: Object.keys(siteContent.navigation),
      pages: Object.keys(siteContent.pages),
    },
  });

  res.json({ ok: true, siteContent });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
  res.json({ ok: true, users: listAdminUsers(limit) });
});

app.get('/api/admin/points/audit', requireAdmin, (req, res) => {
  const limit = parseOptionalLimit(req.query.limit, 200) ?? 200;
  res.json({ ok: true, auditEntries: listAdminPointsAudit(limit) });
});

app.get('/api/admin/badges', requireAdmin, (_req, res) => {
  res.json({ ok: true, badges: listAdminBadges() });
});

app.get('/api/admin/change-requests', requireAdmin, (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  res.json({ ok: true, changeRequests: listAdminChangeRequests(state) });
});

app.get('/api/admin/change-requests/:id', requireAdmin, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getAdminChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  res.json({ ok: true, changeRequest });
});

app.post('/api/admin/uploads/badge-image', requireAdmin, badgeImageUpload.single('file'), (req, res) => {
  const sessionUser = requireSessionUser(res);

  if (!req.file) {
    res.status(400).json({ ok: false, error: 'Image file is required' });
    return;
  }

  const imageUrl = toUploadUrl('badges', req.file.filename);

  createAuditLog({
    actorUserId: sessionUser.id,
    actionType: 'admin.badge_image.upload',
    targetType: 'upload',
    targetId: imageUrl,
    meta: {
      imageUrl,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    },
  });

  res.status(201).json({ ok: true, imageUrl });
});

app.post('/api/admin/badges', requireAdmin, (req, res) => {
  const sessionUser = requireSessionUser(res);
  const label = parseString(req.body?.label);
  const requestedSlug = parseString(req.body?.slug);
  const description = parseNullableString(req.body?.description);
  const imageUrl = parseNullableString(req.body?.imageUrl || req.body?.image_url);
  const slug = slugifyValue(requestedSlug || label);

  if (!slug || !label) {
    res.status(400).json({ ok: false, error: 'Badge label and slug are required' });
    return;
  }

  const badge = upsertAdminBadge({ slug, label, description: description ?? null, imageUrl: imageUrl ?? null });

  createAuditLog({
    actorUserId: sessionUser.id,
    actionType: 'admin.badge.upsert',
    targetType: 'badge',
    targetId: badge?.slug ?? slug,
    meta: { slug, label },
  });

  res.status(201).json({ ok: true, badge });
});

app.patch('/api/admin/badges/:slug', requireAdmin, (req, res) => {
  const sessionUser = requireSessionUser(res);
  const slug = readRouteParam(req.params.slug);
  const existing = getAdminBadgeBySlug(slug);

  if (!existing) {
    res.status(404).json({ ok: false, error: 'Badge not found' });
    return;
  }

  const label = parseString(req.body?.label);
  const description = parseNullableString(req.body?.description);
  const imageUrl = parseNullableString(req.body?.imageUrl || req.body?.image_url);
  const badge = updateAdminBadge(slug, {
    ...(label ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
  });

  createAuditLog({
    actorUserId: sessionUser.id,
    actionType: 'admin.badge.update',
    targetType: 'badge',
    targetId: slug,
    meta: {
      label: badge?.label ?? existing.label,
      imageUrl: badge?.imageUrl ?? existing.imageUrl,
    },
  });

  res.json({ ok: true, badge });
});

app.post('/api/admin/change-requests', requireAdmin, (req, res) => {
  const sessionUser = requireSessionUser(res);
  const requestType = parseString(req.body?.requestType || req.body?.request_type);
  const title = parseString(req.body?.title);
  const priority = parseString(req.body?.priority) || 'normal';

  if (!requestType || !title) {
    res.status(400).json({ ok: false, error: 'requestType and title are required' });
    return;
  }

  let payload: Record<string, unknown>;

  try {
    payload = normalizeAdminChangeRequestPayload(requestType, req.body?.payload);
  } catch (error) {
    if (error instanceof Error && error.message === 'NO_TARGET_USERS') {
      res.status(400).json({ ok: false, error: 'Select at least one target user for points requests' });
      return;
    }

    if (error instanceof Error && error.message === 'INVALID_POINTS_DELTA') {
      res.status(400).json({ ok: false, error: 'Points requests require a non-zero integer delta' });
      return;
    }

    if (error instanceof Error && error.message === 'CHANGE_REQUEST_REASON_REQUIRED') {
      res.status(400).json({ ok: false, error: 'A reason is required for points and badge issuance requests' });
      return;
    }

    if (error instanceof Error && error.message === 'BADGE_DETAILS_REQUIRED') {
      res.status(400).json({ ok: false, error: 'Badge requests require a badge slug or label' });
      return;
    }

    if (error instanceof Error && error.message === 'BADGE_SELECTION_REQUIRED') {
      res.status(400).json({ ok: false, error: 'Badge award requests require an existing badge selection' });
      return;
    }

    if (error instanceof Error && error.message === 'SITE_CONTENT_REQUIRED') {
      res.status(400).json({ ok: false, error: 'Brand and copy requests require a site content JSON payload' });
      return;
    }

    throw error;
  }

  const changeRequest = createAdminChangeRequest({
    requestType,
    title,
    priority,
    payload,
    requestedByUserId: sessionUser.id,
  });

  createAuditLog({
    actorUserId: sessionUser.id,
    actionType: 'admin.change_request.create',
    targetType: 'admin_change_request',
    targetId: changeRequest?.id ?? null,
    meta: { requestType, priority },
  });

  res.status(201).json({ ok: true, changeRequest });
});

app.post('/api/admin/change-requests/:id/apply', requireAdmin, (req, res) => {
  const sessionUser = requireSessionUser(res);
  const changeRequestId = readRouteParam(req.params.id);
  const resolutionNote = typeof req.body?.resolutionNote === 'string' ? req.body.resolutionNote : undefined;

  try {
    const result = applyAdminChangeRequest(changeRequestId, sessionUser.id, resolutionNote);

    if (!result) {
      res.status(404).json({ ok: false, error: 'Change request not found' });
      return;
    }

    createAuditLog({
      actorUserId: sessionUser.id,
      actionType: 'admin.change_request.apply',
      targetType: 'admin_change_request',
      targetId: result.changeRequest.id,
      meta: { ...result.applyResult },
    });

    res.json({ ok: true, changeRequest: result.changeRequest, applyResult: result.applyResult });
  } catch (error) {
    if (error instanceof Error && error.message === 'ALREADY_APPLIED') {
      res.status(409).json({ ok: false, error: 'This change request has already been applied' });
      return;
    }

    if (error instanceof Error && error.message === 'NO_TARGET_USERS') {
      res.status(400).json({ ok: false, error: 'Select at least one target user before applying the request' });
      return;
    }

    if (error instanceof Error && error.message === 'NO_VALID_TARGET_USERS') {
      res.status(400).json({ ok: false, error: 'No valid target users were found for this request' });
      return;
    }

    if (error instanceof Error && error.message === 'INVALID_POINTS_DELTA') {
      res.status(400).json({ ok: false, error: 'Points requests require a non-zero integer delta' });
      return;
    }

    if (error instanceof Error && error.message === 'CHANGE_REQUEST_REASON_REQUIRED') {
      res.status(400).json({ ok: false, error: 'A reason is required before issuing points or badges' });
      return;
    }

    if (error instanceof Error && error.message === 'BADGE_DETAILS_REQUIRED') {
      res.status(400).json({ ok: false, error: 'Badge requests require a badge slug or label' });
      return;
    }

    if (error instanceof Error && error.message === 'BADGE_SELECTION_REQUIRED') {
      res.status(400).json({ ok: false, error: 'Choose an existing badge before applying this request' });
      return;
    }

    if (error instanceof Error && error.message === 'BADGE_NOT_FOUND') {
      res.status(400).json({ ok: false, error: 'The selected badge no longer exists' });
      return;
    }

    if (error instanceof Error && error.message === 'SITE_CONTENT_REQUIRED') {
      res.status(400).json({ ok: false, error: 'This request is missing a valid site content payload' });
      return;
    }

    if (error instanceof Error && error.message === 'UNSUPPORTED_REQUEST_TYPE') {
      res.status(400).json({ ok: false, error: 'Only points, badge, and brand or copy requests can be applied from the admin board right now' });
      return;
    }

    throw error;
  }
});

app.patch('/api/admin/change-requests/:id', requireAdmin, (req, res) => {
  const sessionUser = requireSessionUser(res);
  const changeRequestId = readRouteParam(req.params.id);
  const nextState = typeof req.body?.state === 'string' ? req.body.state : undefined;
  const nextPriority = typeof req.body?.priority === 'string' ? req.body.priority : undefined;
  const resolutionNote = typeof req.body?.resolutionNote === 'string' ? req.body.resolutionNote : undefined;

  if (nextState && !['pending', 'opened', 'closed'].includes(nextState)) {
    res.status(400).json({ ok: false, error: 'Invalid state' });
    return;
  }

  if (nextPriority && !['low', 'normal', 'high', 'urgent'].includes(nextPriority)) {
    res.status(400).json({ ok: false, error: 'Invalid priority' });
    return;
  }

  const changeRequest = updateAdminChangeRequest(changeRequestId, {
    state: nextState,
    priority: nextPriority,
    resolutionNote,
    assignedToUserId: sessionUser.id,
  });

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  createAuditLog({
    actorUserId: sessionUser.id,
    actionType: 'admin.change_request.update',
    targetType: 'admin_change_request',
    targetId: changeRequest.id,
    meta: {
      state: changeRequest.state,
      priority: changeRequest.priority,
      resolutionNote: changeRequest.resolutionNote,
    },
  });

  res.json({ ok: true, changeRequest });
});

app.get('/api/admin/target-apps', requireAdminSessionOrPassword, (_req, res) => {
  res.json({ ok: true, targetApps: listTargetApps() });
});

app.post('/api/admin/target-apps', requireAdminSessionOrPassword, (req, res) => {
  const sessionUser = getOptionalSessionUser(res);
  const slug = parseString(req.body?.slug);
  const name = parseString(req.body?.name);
  const deployBackend = parseString(req.body?.deployBackend || req.body?.deploy_backend);

  if (!slug || !name || !deployBackend) {
    res.status(400).json({ ok: false, error: 'slug, name, and deployBackend are required' });
    return;
  }

  const targetApp = createTargetApp({
    slug,
    name,
    description: parseNullableString(req.body?.description) ?? null,
    repoUrl: parseNullableString(req.body?.repoUrl || req.body?.repo_url) ?? null,
    repoProvider: parseNullableString(req.body?.repoProvider || req.body?.repo_provider) ?? null,
    defaultBranch: parseNullableString(req.body?.defaultBranch || req.body?.default_branch) ?? 'main',
    framework: parseNullableString(req.body?.framework) ?? null,
    deployBackend,
    deployConfig:
      req.body?.deployConfig && typeof req.body.deployConfig === 'object' && !Array.isArray(req.body.deployConfig)
        ? req.body.deployConfig
        : {},
    agentEnabled: req.body?.agentEnabled !== false && req.body?.agent_enabled !== false,
  });

  createAuditLog({
    actorUserId: sessionUser?.id ?? null,
    actionType: 'admin.target_app.create',
    targetType: 'target_app',
    targetId: targetApp?.id ?? null,
    meta: { slug, name, deployBackend },
  });

  res.status(201).json({ ok: true, targetApp });
});

app.get('/api/admin/target-environments', requireAdminSessionOrPassword, (req, res) => {
  const targetAppId = typeof req.query.targetAppId === 'string' ? req.query.targetAppId : undefined;
  res.json({ ok: true, targetEnvironments: listTargetEnvironments(targetAppId) });
});

app.get('/api/admin/setup/status', requireAdminSessionOrPassword, async (_req, res) => {
  async function fetchJson(baseUrl: string, path: string) {
    if (!baseUrl) {
      return { ok: false, configured: false, status: null, payload: null, error: 'BASE_URL_MISSING' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
      const payload = await response.json().catch(() => null);
      return {
        ok: response.ok,
        configured: true,
        status: response.status,
        payload,
        error: response.ok ? null : 'HEALTHCHECK_FAILED',
      };
    } catch (error) {
      return {
        ok: false,
        configured: true,
        status: null,
        payload: null,
        error: error instanceof Error ? error.message : 'HEALTHCHECK_ERROR',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const [prismMemory, codexRuntime] = await Promise.all([
    fetchJson(config.prismMemoryBaseUrl, '/health'),
    fetchJson(config.codexRuntimeBaseUrl, '/health'),
  ]);

  const codexPayload =
    codexRuntime.payload && typeof codexRuntime.payload === 'object' && !Array.isArray(codexRuntime.payload)
      ? codexRuntime.payload as Record<string, unknown>
      : {};
  const prismPayload =
    prismMemory.payload && typeof prismMemory.payload === 'object' && !Array.isArray(prismMemory.payload)
      ? prismMemory.payload as Record<string, unknown>
      : {};

  res.json({
    ok: true,
    setup: {
      prismMemory: {
        configured: prismMemory.configured,
        reachable: prismMemory.ok,
        status: prismMemory.status,
        error: prismMemory.error,
        space: typeof prismPayload.space === 'string' ? prismPayload.space : null,
      },
      codexRuntime: {
        configured: codexRuntime.configured,
        reachable: codexRuntime.ok,
        status: codexRuntime.status,
        error: codexRuntime.error,
        codexAuthConfigured: codexPayload.codexAuthConfigured === true,
        codexHome: typeof codexPayload.codexHome === 'string' ? codexPayload.codexHome : null,
      },
      targets: {
        targetAppCount: listTargetApps().length,
        targetEnvironmentCount: listTargetEnvironments().length,
      },
      community: {
        provider: config.communityProvider,
      },
    },
  });
});

app.post('/api/admin/target-environments', requireAdminSessionOrPassword, (req, res) => {
  const sessionUser = getOptionalSessionUser(res);
  const targetAppId = parseString(req.body?.targetAppId || req.body?.target_app_id);
  const slug = parseString(req.body?.slug);
  const name = parseString(req.body?.name);
  const kind = parseString(req.body?.kind);
  const deployBackend = parseString(req.body?.deployBackend || req.body?.deploy_backend);

  if (!targetAppId || !slug || !name || !kind || !deployBackend) {
    res.status(400).json({ ok: false, error: 'targetAppId, slug, name, kind, and deployBackend are required' });
    return;
  }

  if (!targetEnvironmentKinds.includes(kind)) {
    res.status(400).json({ ok: false, error: 'Invalid environment kind' });
    return;
  }

  const targetEnvironment = createTargetEnvironment({
    targetAppId,
    slug,
    name,
    kind,
    branch: parseNullableString(req.body?.branch) ?? null,
    baseUrl: parseNullableString(req.body?.baseUrl || req.body?.base_url) ?? null,
    deployBackend,
    deployConfig:
      req.body?.deployConfig && typeof req.body.deployConfig === 'object' && !Array.isArray(req.body.deployConfig)
        ? req.body.deployConfig
        : {},
    agentWritable: req.body?.agentWritable === true || req.body?.agent_writable === true,
    autoDeployEnabled: req.body?.autoDeployEnabled === true || req.body?.auto_deploy_enabled === true,
    humanReviewRequired: req.body?.humanReviewRequired !== false && req.body?.human_review_required !== false,
    isDefaultForAgent: req.body?.isDefaultForAgent === true || req.body?.is_default_for_agent === true,
  });

  createAuditLog({
    actorUserId: sessionUser?.id ?? null,
    actionType: 'admin.target_environment.create',
    targetType: 'target_environment',
    targetId: targetEnvironment?.id ?? null,
    meta: { targetAppId, slug, kind, deployBackend },
  });

  res.status(201).json({ ok: true, targetEnvironment });
});

app.get('/api/admin/change-board/requests', requireAdminSessionOrPassword, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const targetAppId = typeof req.query.targetAppId === 'string' ? req.query.targetAppId : undefined;
  res.json({ ok: true, changeRequests: listChangeRequests({ status, targetAppId }) });
});

app.get('/api/internal/change-board/requests/next', requireServiceToken, (req, res) => {
  const targetAppId = typeof req.query.targetAppId === 'string' ? req.query.targetAppId : undefined;
  const changeRequest = getNextQueuedChangeRequest({ targetAppId });

  if (!changeRequest) {
    res.json({
      ok: true,
      changeRequest: null,
      targetApp: null,
      targetEnvironment: null,
      deployPlan: null,
      latestExecution: null,
    });
    return;
  }

  const targetApp = getTargetApp(changeRequest.targetAppId);
  const targetEnvironment = changeRequest.targetEnvironmentId
    ? getTargetEnvironment(changeRequest.targetEnvironmentId)
    : null;
  const latestExecution = listChangeRequestExecutions(changeRequest.id)[0] ?? null;

  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({
        request: changeRequest,
        targetApp,
        targetEnvironment,
      })
    : null;

  res.json({
    ok: true,
    changeRequest,
    targetApp,
    targetEnvironment,
    deployPlan,
    latestExecution,
  });
});

app.get('/api/internal/change-board/requests/current', requireServiceToken, (req, res) => {
  const targetAppId = typeof req.query.targetAppId === 'string' ? req.query.targetAppId : undefined;
  const changeRequest = getCurrentActiveChangeRequest({ targetAppId });

  if (!changeRequest) {
    res.json({
      ok: true,
      changeRequest: null,
      targetApp: null,
      targetEnvironment: null,
      deployPlan: null,
      latestExecution: null,
    });
    return;
  }

  const targetApp = getTargetApp(changeRequest.targetAppId);
  const targetEnvironment = changeRequest.targetEnvironmentId
    ? getTargetEnvironment(changeRequest.targetEnvironmentId)
    : null;
  const latestExecution = listChangeRequestExecutions(changeRequest.id)[0] ?? null;

  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({
        request: changeRequest,
        targetApp,
        targetEnvironment,
      })
    : null;

  res.json({
    ok: true,
    changeRequest,
    targetApp,
    targetEnvironment,
    deployPlan,
    latestExecution,
  });
});

app.get('/api/internal/change-board/requests/:id', requireServiceToken, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  const targetApp = getTargetApp(changeRequest.targetAppId);
  const targetEnvironment = changeRequest.targetEnvironmentId
    ? getTargetEnvironment(changeRequest.targetEnvironmentId)
    : null;
  const latestExecution = listChangeRequestExecutions(changeRequest.id)[0] ?? null;
  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({
        request: changeRequest,
        targetApp,
        targetEnvironment,
      })
    : null;

  res.json({
    ok: true,
    changeRequest,
    targetApp,
    targetEnvironment,
    deployPlan,
    latestExecution,
  });
});

app.patch('/api/internal/change-board/requests/:id', requireServiceToken, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const existingChangeRequest = getChangeRequest(changeRequestId);
  const nextStatus = typeof req.body?.status === 'string' ? req.body.status : undefined;
  const nextPriority = typeof req.body?.priority === 'string' ? req.body.priority : undefined;

  if (!existingChangeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  if (nextStatus && !trackedChangeRequestStatuses.includes(nextStatus)) {
    res.status(400).json({ ok: false, error: 'Invalid status' });
    return;
  }

  if (nextPriority && !trackedChangeRequestPriorities.includes(nextPriority)) {
    res.status(400).json({ ok: false, error: 'Invalid priority' });
    return;
  }

  if (nextStatus && isTriageOnlyStatus(existingChangeRequest.status) && isExecutionStatus(nextStatus)) {
    res.status(409).json({
      ok: false,
      error: 'CHANGE_REQUEST_NOT_READY_FOR_EXECUTION',
    });
    return;
  }

  const changeRequest = updateChangeRequest(changeRequestId, {
    status: nextStatus,
    priority: nextPriority,
    targetEnvironmentId:
      req.body?.targetEnvironmentId !== undefined || req.body?.target_environment_id !== undefined
        ? parseNullableString(req.body?.targetEnvironmentId || req.body?.target_environment_id) ?? null
        : undefined,
    triageSummary:
      req.body?.triageSummary !== undefined || req.body?.triage_summary !== undefined
        ? parseNullableString(req.body?.triageSummary || req.body?.triage_summary) ?? null
        : undefined,
    reviewNotes:
      req.body?.reviewNotes !== undefined || req.body?.review_notes !== undefined
        ? parseNullableString(req.body?.reviewNotes || req.body?.review_notes) ?? null
        : undefined,
    resolutionSummary:
      req.body?.resolutionSummary !== undefined || req.body?.resolution_summary !== undefined
        ? parseNullableString(req.body?.resolutionSummary || req.body?.resolution_summary) ?? null
        : undefined,
    agentRecommendation:
      req.body?.agentRecommendation !== undefined || req.body?.agent_recommendation !== undefined
        ? parseNullableString(req.body?.agentRecommendation || req.body?.agent_recommendation) ?? null
        : undefined,
  });

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  res.json({ ok: true, changeRequest });
});

app.get('/api/internal/change-board/requests/:id/executions', requireServiceToken, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  res.json({ ok: true, executions: listChangeRequestExecutions(changeRequestId) });
});

app.get('/api/internal/target-apps', requireServiceToken, (_req, res) => {
  res.json({ ok: true, targetApps: listTargetApps() });
});

app.post('/api/internal/change-board/requests', requireServiceToken, (req, res) => {
  const title = parseString(req.body?.title);
  const description = parseString(req.body?.description);
  const requestType = parseString(req.body?.requestType || req.body?.request_type);
  const targetAppId = parseString(req.body?.targetAppId || req.body?.target_app_id);
  const status = parseString(req.body?.status) || 'submitted';
  const priority = parseString(req.body?.priority) || 'normal';

  if (!title || !description || !requestType || !targetAppId) {
    res.status(400).json({ ok: false, error: 'title, description, requestType, and targetAppId are required' });
    return;
  }

  if (!trackedChangeRequestTypes.includes(requestType)) {
    res.status(400).json({ ok: false, error: 'Invalid request type' });
    return;
  }

  if (!trackedChangeRequestStatuses.includes(status)) {
    res.status(400).json({ ok: false, error: 'Invalid status' });
    return;
  }

  if (!trackedChangeRequestPriorities.includes(priority)) {
    res.status(400).json({ ok: false, error: 'Invalid priority' });
    return;
  }

  const changeRequest = createChangeRequest({
    title,
    description,
    requestType,
    status,
    priority,
    source: parseString(req.body?.source) || 'chat',
    requestedByUserId: null,
    targetAppId,
    targetEnvironmentId:
      parseNullableString(req.body?.targetEnvironmentId || req.body?.target_environment_id)
      ?? getDefaultTargetEnvironmentForApp(targetAppId)?.id
      ?? null,
    triageSummary: parseNullableString(req.body?.triageSummary || req.body?.triage_summary) ?? null,
    acceptanceCriteria: Array.isArray(req.body?.acceptanceCriteria) ? req.body.acceptanceCriteria : [],
    constraints:
      req.body?.constraints && typeof req.body.constraints === 'object' && !Array.isArray(req.body.constraints)
        ? req.body.constraints
        : {},
    attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
    agentRecommendation: parseNullableString(req.body?.agentRecommendation || req.body?.agent_recommendation) ?? null,
  });

  res.status(201).json({ ok: true, changeRequest });
});

app.post('/api/internal/change-board/requests/:id/executions', requireServiceToken, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  if (isTriageOnlyStatus(changeRequest.status)) {
    res.status(409).json({ ok: false, error: 'CHANGE_REQUEST_NOT_READY_FOR_EXECUTION' });
    return;
  }

  if (hasActiveExecution(changeRequestId)) {
    res.status(409).json({ ok: false, error: 'CHANGE_REQUEST_EXECUTION_ALREADY_RUNNING' });
    return;
  }

  const execution = createChangeRequestExecution({
    changeRequestId,
    targetEnvironmentId:
      parseNullableString(req.body?.targetEnvironmentId || req.body?.target_environment_id) ?? changeRequest.targetEnvironmentId,
    status: parseString(req.body?.status) || 'planned',
    actorType: parseString(req.body?.actorType || req.body?.actor_type) || 'codex',
    branchName: parseNullableString(req.body?.branchName || req.body?.branch_name) ?? null,
    commitSha: parseNullableString(req.body?.commitSha || req.body?.commit_sha) ?? null,
    deployUrl: parseNullableString(req.body?.deployUrl || req.body?.deploy_url) ?? null,
    adapterKind: parseNullableString(req.body?.adapterKind || req.body?.adapter_kind) ?? null,
    adapterStatus: parseNullableString(req.body?.adapterStatus || req.body?.adapter_status) ?? null,
    summary: parseNullableString(req.body?.summary) ?? null,
    errorMessage: parseNullableString(req.body?.errorMessage || req.body?.error_message) ?? null,
    meta: req.body?.meta && typeof req.body.meta === 'object' && !Array.isArray(req.body.meta) ? req.body.meta : {},
    startedAt: parseNullableString(req.body?.startedAt || req.body?.started_at) ?? null,
    finishedAt: parseNullableString(req.body?.finishedAt || req.body?.finished_at) ?? null,
  });

  res.status(201).json({ ok: true, execution });
});

app.patch('/api/internal/change-board/executions/:executionId', requireServiceToken, (req, res) => {
  const executionId = readRouteParam(req.params.executionId);

  const execution = updateChangeRequestExecution(executionId, {
    status: typeof req.body?.status === 'string' ? req.body.status : undefined,
    targetEnvironmentId:
      req.body?.targetEnvironmentId !== undefined || req.body?.target_environment_id !== undefined
        ? parseNullableString(req.body?.targetEnvironmentId || req.body?.target_environment_id) ?? null
        : undefined,
    branchName:
      req.body?.branchName !== undefined || req.body?.branch_name !== undefined
        ? parseNullableString(req.body?.branchName || req.body?.branch_name) ?? null
        : undefined,
    commitSha:
      req.body?.commitSha !== undefined || req.body?.commit_sha !== undefined
        ? parseNullableString(req.body?.commitSha || req.body?.commit_sha) ?? null
        : undefined,
    deployUrl:
      req.body?.deployUrl !== undefined || req.body?.deploy_url !== undefined
        ? parseNullableString(req.body?.deployUrl || req.body?.deploy_url) ?? null
        : undefined,
    adapterKind:
      req.body?.adapterKind !== undefined || req.body?.adapter_kind !== undefined
        ? parseNullableString(req.body?.adapterKind || req.body?.adapter_kind) ?? null
        : undefined,
    adapterStatus:
      req.body?.adapterStatus !== undefined || req.body?.adapter_status !== undefined
        ? parseNullableString(req.body?.adapterStatus || req.body?.adapter_status) ?? null
        : undefined,
    summary: req.body?.summary !== undefined ? parseNullableString(req.body?.summary) ?? null : undefined,
    errorMessage:
      req.body?.errorMessage !== undefined || req.body?.error_message !== undefined
        ? parseNullableString(req.body?.errorMessage || req.body?.error_message) ?? null
        : undefined,
    meta: req.body?.meta && typeof req.body.meta === 'object' && !Array.isArray(req.body.meta) ? req.body.meta : undefined,
    startedAt:
      req.body?.startedAt !== undefined || req.body?.started_at !== undefined
        ? parseNullableString(req.body?.startedAt || req.body?.started_at) ?? null
        : undefined,
    finishedAt:
      req.body?.finishedAt !== undefined || req.body?.finished_at !== undefined
        ? parseNullableString(req.body?.finishedAt || req.body?.finished_at) ?? null
        : undefined,
  });

  if (!execution) {
    res.status(404).json({ ok: false, error: 'Execution not found' });
    return;
  }

  res.json({ ok: true, execution });
});

app.get('/api/internal/change-board/requests/:id/deploy-plan', requireServiceToken, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  if (!changeRequest.targetEnvironmentId) {
    res.status(400).json({ ok: false, error: 'Change request is missing a target environment' });
    return;
  }

  const targetEnvironment = getTargetEnvironment(changeRequest.targetEnvironmentId);
  if (!targetEnvironment) {
    res.status(404).json({ ok: false, error: 'Target environment not found' });
    return;
  }

  const targetApp = getTargetApp(changeRequest.targetAppId);
  if (!targetApp) {
    res.status(404).json({ ok: false, error: 'Target app not found' });
    return;
  }

  const deployPlan = buildTargetEnvironmentDeployPlan({
    request: changeRequest,
    targetApp,
    targetEnvironment,
  });

  res.json({ ok: true, deployPlan });
});

app.get('/api/internal/skills', requireServiceToken, (_req, res) => {
  const skills = listHostedSkills(config.workspaceRoot).map((skill) => ({
    ...skill,
    downloadPath: `/api/internal/skills/${skill.name}/download`,
  }));

  res.json({ ok: true, skills });
});

app.get('/api/internal/skills/:name/download', requireServiceToken, (req, res) => {
  const skillName = readRouteParam(req.params.name);
  const archive = buildHostedSkillArchive(config.workspaceRoot, skillName);

  if (!archive) {
    res.status(404).json({ ok: false, error: 'Hosted skill not found' });
    return;
  }

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${skillName}.tar.gz"`);
  res.send(archive);
});

app.get('/api/admin/change-board/requests/:id', requireAdminSessionOrPassword, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  res.json({ ok: true, changeRequest });
});

app.get('/api/admin/change-board/requests/:id/agent-session', requireAdminSessionOrPassword, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  const session = findLatestAgentSessionByChangeRequest(changeRequestId);
  if (!session) {
    res.json({ ok: true, session: null, messages: [] });
    return;
  }

  res.json({ ok: true, session, messages: listAgentMessages(session.id, 100) });
});

app.post('/api/admin/change-board/requests/:id/agent-session/messages', requireAdminSessionOrPassword, (req, res) => {
  const sessionUser = getOptionalSessionUser(res);
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  const content = parseString(req.body?.content);
  if (!content) {
    res.status(400).json({ ok: false, error: 'content is required' });
    return;
  }

  let session = findLatestAgentSessionByChangeRequest(changeRequestId);
  if (!session) {
    session = createAgentSession({
      source: 'admin-console',
      status: 'active',
      title: changeRequest.title,
      linkedChangeRequestId: changeRequest.id,
      linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
      createdByUserId: sessionUser?.id ?? null,
      meta: {
        transport: 'site',
      },
      lastMessageAt: new Date().toISOString(),
    });
  }

  if (!session) {
    res.status(500).json({ ok: false, error: 'AGENT_SESSION_CREATE_FAILED' });
    return;
  }

  const message = createAgentMessage({
    sessionId: session.id,
    role: 'user',
    source: 'site-comment',
    sourceMessageId: null,
    content,
    meta: {
      transport: 'site',
      kind: 'comment',
    },
  });

  const updatedSession = updateAgentSession(session.id, {
    linkedChangeRequestId: changeRequest.id,
    linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
    lastMessageAt: new Date().toISOString(),
    meta: {
      ...session.meta,
      transport: 'site',
    },
  });

  res.status(201).json({
    ok: true,
    session: updatedSession,
    message,
    messages: listAgentMessages(session.id, 100),
  });
});

app.post('/api/admin/change-board/requests', requireAdminSessionOrPassword, (req, res) => {
  const sessionUser = getOptionalSessionUser(res);
  const title = parseString(req.body?.title);
  const description = parseString(req.body?.description);
  const requestType = parseString(req.body?.requestType || req.body?.request_type);
  const targetAppId = parseString(req.body?.targetAppId || req.body?.target_app_id);
  const status = parseString(req.body?.status) || 'submitted';
  const priority = parseString(req.body?.priority) || 'normal';

  if (!title || !description || !requestType || !targetAppId) {
    res.status(400).json({ ok: false, error: 'title, description, requestType, and targetAppId are required' });
    return;
  }

  if (!trackedChangeRequestTypes.includes(requestType)) {
    res.status(400).json({ ok: false, error: 'Invalid request type' });
    return;
  }

  if (!trackedChangeRequestStatuses.includes(status)) {
    res.status(400).json({ ok: false, error: 'Invalid status' });
    return;
  }

  if (!trackedChangeRequestPriorities.includes(priority)) {
    res.status(400).json({ ok: false, error: 'Invalid priority' });
    return;
  }

  const changeRequest = createChangeRequest({
    title,
    description,
    requestType,
    status,
    priority,
    source: parseString(req.body?.source) || 'manual',
    requestedByUserId: sessionUser?.id ?? null,
    targetAppId,
    targetEnvironmentId:
      parseNullableString(req.body?.targetEnvironmentId || req.body?.target_environment_id)
      ?? getDefaultTargetEnvironmentForApp(targetAppId)?.id
      ?? null,
    triageSummary: parseNullableString(req.body?.triageSummary || req.body?.triage_summary) ?? null,
    acceptanceCriteria: Array.isArray(req.body?.acceptanceCriteria) ? req.body.acceptanceCriteria : [],
    constraints:
      req.body?.constraints && typeof req.body.constraints === 'object' && !Array.isArray(req.body.constraints)
        ? req.body.constraints
        : {},
    attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
    agentRecommendation: parseNullableString(req.body?.agentRecommendation || req.body?.agent_recommendation) ?? null,
  });

  createAuditLog({
    actorUserId: sessionUser?.id ?? null,
    actionType: 'admin.change_board_request.create',
    targetType: 'change_request',
    targetId: changeRequest?.id ?? null,
    meta: { requestType, priority, targetAppId, status },
  });

  res.status(201).json({ ok: true, changeRequest });
});

app.patch('/api/admin/change-board/requests/:id', requireAdminSessionOrPassword, (req, res) => {
  const sessionUser = getOptionalSessionUser(res);
  const changeRequestId = readRouteParam(req.params.id);
  const existingChangeRequest = getChangeRequest(changeRequestId);
  const nextStatus = typeof req.body?.status === 'string' ? req.body.status : undefined;
  const nextPriority = typeof req.body?.priority === 'string' ? req.body.priority : undefined;

  if (!existingChangeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  if (nextStatus && !trackedChangeRequestStatuses.includes(nextStatus)) {
    res.status(400).json({ ok: false, error: 'Invalid status' });
    return;
  }

  if (nextPriority && !trackedChangeRequestPriorities.includes(nextPriority)) {
    res.status(400).json({ ok: false, error: 'Invalid priority' });
    return;
  }

  if (
    nextStatus
    && nextStatus !== existingChangeRequest.status
    && hasActiveExecution(changeRequestId)
  ) {
    res.status(409).json({ ok: false, error: 'CHANGE_REQUEST_EXECUTION_ALREADY_RUNNING' });
    return;
  }

  const changeRequest = updateChangeRequest(changeRequestId, {
    status: nextStatus,
    priority: nextPriority,
    targetEnvironmentId:
      req.body?.targetEnvironmentId !== undefined || req.body?.target_environment_id !== undefined
        ? parseNullableString(req.body?.targetEnvironmentId || req.body?.target_environment_id) ?? null
        : undefined,
    triageSummary:
      req.body?.triageSummary !== undefined || req.body?.triage_summary !== undefined
        ? parseNullableString(req.body?.triageSummary || req.body?.triage_summary) ?? null
        : undefined,
    reviewNotes:
      req.body?.reviewNotes !== undefined || req.body?.review_notes !== undefined
        ? parseNullableString(req.body?.reviewNotes || req.body?.review_notes) ?? null
        : undefined,
    resolutionSummary:
      req.body?.resolutionSummary !== undefined || req.body?.resolution_summary !== undefined
        ? parseNullableString(req.body?.resolutionSummary || req.body?.resolution_summary) ?? null
        : undefined,
    agentRecommendation:
      req.body?.agentRecommendation !== undefined || req.body?.agent_recommendation !== undefined
        ? parseNullableString(req.body?.agentRecommendation || req.body?.agent_recommendation) ?? null
        : undefined,
  });

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  createAuditLog({
    actorUserId: sessionUser?.id ?? null,
    actionType: 'admin.change_board_request.update',
    targetType: 'change_request',
    targetId: changeRequest.id,
    meta: {
      status: changeRequest.status,
      priority: changeRequest.priority,
      targetEnvironmentId: changeRequest.targetEnvironmentId,
    },
  });

  res.json({ ok: true, changeRequest });
});

app.get('/api/admin/change-board/requests/:id/executions', requireAdminSessionOrPassword, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  res.json({ ok: true, executions: listChangeRequestExecutions(changeRequestId) });
});

app.post('/api/admin/change-board/requests/:id/executions', requireAdminSessionOrPassword, (req, res) => {
  const sessionUser = getOptionalSessionUser(res);
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  const execution = createChangeRequestExecution({
    changeRequestId,
    targetEnvironmentId:
      parseNullableString(req.body?.targetEnvironmentId || req.body?.target_environment_id) ?? changeRequest.targetEnvironmentId,
    status: parseString(req.body?.status) || 'planned',
    actorType: parseString(req.body?.actorType || req.body?.actor_type) || 'codex',
    branchName: parseNullableString(req.body?.branchName || req.body?.branch_name) ?? null,
    commitSha: parseNullableString(req.body?.commitSha || req.body?.commit_sha) ?? null,
    deployUrl: parseNullableString(req.body?.deployUrl || req.body?.deploy_url) ?? null,
    adapterKind: parseNullableString(req.body?.adapterKind || req.body?.adapter_kind) ?? null,
    adapterStatus: parseNullableString(req.body?.adapterStatus || req.body?.adapter_status) ?? null,
    summary: parseNullableString(req.body?.summary) ?? null,
    errorMessage: parseNullableString(req.body?.errorMessage || req.body?.error_message) ?? null,
    meta: req.body?.meta && typeof req.body.meta === 'object' && !Array.isArray(req.body.meta) ? req.body.meta : {},
    startedAt: parseNullableString(req.body?.startedAt || req.body?.started_at) ?? null,
    finishedAt: parseNullableString(req.body?.finishedAt || req.body?.finished_at) ?? null,
  });

  createAuditLog({
    actorUserId: sessionUser?.id ?? null,
    actionType: 'admin.change_board_execution.create',
    targetType: 'change_request_execution',
    targetId: execution?.id ?? null,
    meta: { changeRequestId, status: execution?.status ?? null },
  });

  res.status(201).json({ ok: true, execution });
});

app.patch('/api/admin/change-board/executions/:executionId', requireAdminSessionOrPassword, (req, res) => {
  const sessionUser = getOptionalSessionUser(res);
  const executionId = readRouteParam(req.params.executionId);

  const execution = updateChangeRequestExecution(executionId, {
    status: typeof req.body?.status === 'string' ? req.body.status : undefined,
    targetEnvironmentId:
      req.body?.targetEnvironmentId !== undefined || req.body?.target_environment_id !== undefined
        ? parseNullableString(req.body?.targetEnvironmentId || req.body?.target_environment_id) ?? null
        : undefined,
    branchName:
      req.body?.branchName !== undefined || req.body?.branch_name !== undefined
        ? parseNullableString(req.body?.branchName || req.body?.branch_name) ?? null
        : undefined,
    commitSha:
      req.body?.commitSha !== undefined || req.body?.commit_sha !== undefined
        ? parseNullableString(req.body?.commitSha || req.body?.commit_sha) ?? null
        : undefined,
    deployUrl:
      req.body?.deployUrl !== undefined || req.body?.deploy_url !== undefined
        ? parseNullableString(req.body?.deployUrl || req.body?.deploy_url) ?? null
        : undefined,
    adapterKind:
      req.body?.adapterKind !== undefined || req.body?.adapter_kind !== undefined
        ? parseNullableString(req.body?.adapterKind || req.body?.adapter_kind) ?? null
        : undefined,
    adapterStatus:
      req.body?.adapterStatus !== undefined || req.body?.adapter_status !== undefined
        ? parseNullableString(req.body?.adapterStatus || req.body?.adapter_status) ?? null
        : undefined,
    summary: req.body?.summary !== undefined ? parseNullableString(req.body?.summary) ?? null : undefined,
    errorMessage:
      req.body?.errorMessage !== undefined || req.body?.error_message !== undefined
        ? parseNullableString(req.body?.errorMessage || req.body?.error_message) ?? null
        : undefined,
    meta: req.body?.meta && typeof req.body.meta === 'object' && !Array.isArray(req.body.meta) ? req.body.meta : undefined,
    startedAt:
      req.body?.startedAt !== undefined || req.body?.started_at !== undefined
        ? parseNullableString(req.body?.startedAt || req.body?.started_at) ?? null
        : undefined,
    finishedAt:
      req.body?.finishedAt !== undefined || req.body?.finished_at !== undefined
        ? parseNullableString(req.body?.finishedAt || req.body?.finished_at) ?? null
        : undefined,
  });

  if (!execution) {
    res.status(404).json({ ok: false, error: 'Execution not found' });
    return;
  }

  createAuditLog({
    actorUserId: sessionUser?.id ?? null,
    actionType: 'admin.change_board_execution.update',
    targetType: 'change_request_execution',
    targetId: execution.id,
    meta: { status: execution.status, deployUrl: execution.deployUrl },
  });

  res.json({ ok: true, execution });
});

app.get('/api/admin/change-board/requests/:id/deploy-plan', requireAdminSessionOrPassword, (req, res) => {
  const changeRequestId = readRouteParam(req.params.id);
  const changeRequest = getChangeRequest(changeRequestId);

  if (!changeRequest) {
    res.status(404).json({ ok: false, error: 'Change request not found' });
    return;
  }

  if (!changeRequest.targetEnvironmentId) {
    res.status(400).json({ ok: false, error: 'Change request is missing a target environment' });
    return;
  }

  const targetEnvironment = getTargetEnvironment(changeRequest.targetEnvironmentId);
  if (!targetEnvironment) {
    res.status(404).json({ ok: false, error: 'Target environment not found' });
    return;
  }

  const targetApp = getTargetApp(changeRequest.targetAppId);
  if (!targetApp) {
    res.status(404).json({ ok: false, error: 'Target app not found' });
    return;
  }

  const deployPlan = buildTargetEnvironmentDeployPlan({
    request: changeRequest,
    targetApp,
    targetEnvironment,
  });

  res.json({ ok: true, deployPlan });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ ok: false, error: 'Image upload must be 5MB or smaller' });
    return;
  }

  if (error instanceof Error && error.message === 'INVALID_IMAGE_TYPE') {
    res.status(400).json({ ok: false, error: 'Only image uploads are supported' });
    return;
  }

  console.error(error);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Prism Agent API listening on ${config.port}`);
});
