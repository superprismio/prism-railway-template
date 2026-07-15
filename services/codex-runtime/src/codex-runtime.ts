import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { loadRelevantPrismSkills } from './prism-skills.js';
import { gatewayClient, runtimeCapabilitySessions } from './runtime-gateway.js';
import { mergeSkillCapabilityRequirements } from './capability-requirements.js';

type HistoryEntry = {
  role: string;
  content: string;
};

type LinkedTargetAppMetadata = {
  id?: string;
  slug?: string;
  name?: string;
  defaultBranch?: string;
  repoUrl?: string | null;
  repoProvider?: string | null;
  deployBackend?: string;
  deployConfig?: Record<string, unknown>;
};

type LinkedTargetEnvironmentMetadata = {
  id?: string;
  slug?: string;
  name?: string;
  kind?: string;
  branch?: string | null;
  baseUrl?: string | null;
  deployBackend?: string;
  deployConfig?: Record<string, unknown>;
  agentWritable?: boolean;
};

type LinkedChangeRequestMetadata = {
  id?: string;
  requestNumber?: number;
  title?: string;
  status?: string;
};

type LinkedLatestExecutionMetadata = {
  id?: string;
  branchName?: string | null;
  commitSha?: string | null;
  meta?: Record<string, unknown>;
};

export type CodexRuntimeInput = {
  prompt: string;
  recentHistory: HistoryEntry[];
  sessionId: string;
  codexThreadId?: string | null;
  capabilities?: RuntimeCapabilityDescriptor[];
  credentials?: string[];
  gatewayContext?: Record<string, string>;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  onTrace?: (trace: CodexRuntimeResult['trace']) => void;
};

export type RuntimeCapabilityDescriptor = {
  key: string;
  mode?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type CodexRuntimeResult = {
  provider: 'codex-cli';
  model: string | null;
  responseText: string;
  codexThreadId: string | null;
  branchName: string | null;
  commitSha: string | null;
  branchUrl: string | null;
  baseBranch: string | null;
  baseCommitSha: string | null;
  trace: Array<{
    at: string;
    kind: string;
    message: string;
  }>;
};

type CodexRuntimeError = Error & {
  codexThreadId?: string | null;
  trace?: Array<{
    at: string;
    kind: string;
    message: string;
  }>;
};

type GitHubRepoAccess = {
  login: string | null;
  repoSlug: string;
  canPull: boolean | null;
  canPush: boolean | null;
};

function slugifySegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseLinkedTargetApp(metadata: Record<string, unknown> | undefined): LinkedTargetAppMetadata | null {
  if (!metadata?.linkedTargetApp || typeof metadata.linkedTargetApp !== 'object' || Array.isArray(metadata.linkedTargetApp)) {
    return null;
  }

  return metadata.linkedTargetApp as LinkedTargetAppMetadata;
}

function parseLinkedTargetEnvironment(metadata: Record<string, unknown> | undefined): LinkedTargetEnvironmentMetadata | null {
  if (
    !metadata?.linkedTargetEnvironment
    || typeof metadata.linkedTargetEnvironment !== 'object'
    || Array.isArray(metadata.linkedTargetEnvironment)
  ) {
    return null;
  }

  return metadata.linkedTargetEnvironment as LinkedTargetEnvironmentMetadata;
}

function parseLinkedChangeRequest(metadata: Record<string, unknown> | undefined): LinkedChangeRequestMetadata | null {
  if (!metadata?.linkedChangeRequest || typeof metadata.linkedChangeRequest !== 'object' || Array.isArray(metadata.linkedChangeRequest)) {
    return null;
  }

  return metadata.linkedChangeRequest as LinkedChangeRequestMetadata;
}

function parseLinkedLatestExecution(metadata: Record<string, unknown> | undefined): LinkedLatestExecutionMetadata | null {
  if (!metadata?.linkedLatestExecution || typeof metadata.linkedLatestExecution !== 'object' || Array.isArray(metadata.linkedLatestExecution)) {
    return null;
  }

  return metadata.linkedLatestExecution as LinkedLatestExecutionMetadata;
}

function shouldHydrateExternalWorkspace(metadata: Record<string, unknown> | undefined) {
  const targetApp = parseLinkedTargetApp(metadata);
  if (!targetApp?.repoUrl || typeof targetApp.repoUrl !== 'string') {
    return false;
  }

  const deployConfig =
    targetApp.deployConfig && typeof targetApp.deployConfig === 'object' && !Array.isArray(targetApp.deployConfig)
      ? targetApp.deployConfig
      : null;

  return deployConfig?.workspace === 'external';
}

function parseGitHubRepoSlug(repoUrl: string): { owner: string; repo: string; slug: string } | null {
  const match = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) {
    return null;
  }
  const [, owner, repo] = match;
  return { owner, repo, slug: `${owner}/${repo}` };
}

function looksLikeGitHubAuthError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('github.com') &&
    (
      lower.includes('403')
      || lower.includes('authentication failed')
      || lower.includes('permission to')
      || lower.includes('could not read username')
      || lower.includes('requested url returned error')
    )
  );
}

async function inspectGitHubRepoAccess(repoUrl: string, githubToken: string | null): Promise<GitHubRepoAccess | null> {
  const parsed = parseGitHubRepoSlug(repoUrl);
  if (!parsed || !githubToken) {
    return null;
  }

  const response = await fetch(`https://api.github.com/repos/${parsed.slug}`, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      'User-Agent': 'prism-codex-runtime',
      Accept: 'application/vnd.github+json',
    },
  }).catch(() => null);

  if (!response) {
    return {
      login: null,
      repoSlug: parsed.slug,
      canPull: null,
      canPush: null,
    };
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const permissions =
    payload?.permissions && typeof payload.permissions === 'object' && !Array.isArray(payload.permissions)
      ? payload.permissions as Record<string, unknown>
      : null;
  const owner =
    payload?.owner && typeof payload.owner === 'object' && !Array.isArray(payload.owner)
      ? payload.owner as Record<string, unknown>
      : null;

  return {
    login: typeof payload?.login === 'string'
      ? payload.login
      : typeof owner?.login === 'string'
        ? owner.login
        : null,
    repoSlug: parsed.slug,
    canPull: typeof permissions?.pull === 'boolean' ? permissions.pull : null,
    canPush: typeof permissions?.push === 'boolean' ? permissions.push : null,
  };
}

async function normalizeGitHubRepoError(
  repoUrl: string,
  operation: 'clone' | 'fetch' | 'push',
  error: unknown,
  githubToken: string | null,
): Promise<Error> {
  const message = error instanceof Error ? error.message : String(error);
  if (!looksLikeGitHubAuthError(message)) {
    return error instanceof Error ? error : new Error(message);
  }

  const parsed = parseGitHubRepoSlug(repoUrl);
  const access = await inspectGitHubRepoAccess(repoUrl, githubToken);
  const repoSlug = access?.repoSlug || parsed?.slug || repoUrl;
  const login = access?.login || 'configured GitHub token';

  if (access?.canPull === true && access?.canPush === false) {
    return new Error(
      `TARGET_REPO_AUTH_FAILED: GitHub token for ${login} can read but cannot push branches to ${repoSlug}. Check TARGET_REPO_GITHUB_TOKEN and repo collaborator/team access.`,
    );
  }

  if (access?.canPull === false) {
    return new Error(
      `TARGET_REPO_AUTH_FAILED: GitHub token for ${login} cannot read ${repoSlug}. Check TARGET_REPO_GITHUB_TOKEN and repo access.`,
    );
  }

  if (operation === 'push') {
    return new Error(
      `TARGET_REPO_AUTH_FAILED: GitHub push failed for ${repoSlug} using ${login}. Check TARGET_REPO_GITHUB_TOKEN and repo write access. Original error: ${message}`,
    );
  }

  return new Error(
    `TARGET_REPO_AUTH_FAILED: GitHub ${operation} failed for ${repoSlug} using ${login}. Check TARGET_REPO_GITHUB_TOKEN and repo access. Original error: ${message}`,
  );
}

function buildGitHubAuthArgs(repoUrl: string, githubToken: string | null) {
  if (!repoUrl.startsWith('https://github.com/')) {
    return [];
  }

  if (!githubToken) {
    throw new Error('TARGET_REPO_AUTH_MISSING:GITHUB_TOKEN');
  }

  const basicAuth = Buffer.from(`x-access-token:${githubToken}`).toString('base64');
  return ['-c', `http.extraheader=AUTHORIZATION: basic ${basicAuth}`];
}

function isGitHubHttpsRepo(repoUrl: string) {
  return repoUrl.startsWith('https://github.com/');
}

async function runGitHubReadCommand(
  repoUrl: string,
  gitArgs: string[],
  githubToken: string | null,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  if (!isGitHubHttpsRepo(repoUrl)) {
    await runCommand(['git', ...gitArgs], options);
    return;
  }

  try {
    await runCommand(['git', ...gitArgs], options);
    return;
  } catch (error) {
    if (!githubToken) {
      throw error;
    }
  }

  await runCommand(['git', ...buildGitHubAuthArgs(repoUrl, githubToken), ...gitArgs], options);
}

async function runGitHubReadCapture(
  repoUrl: string,
  gitArgs: string[],
  githubToken: string | null,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  if (!isGitHubHttpsRepo(repoUrl)) {
    return await runCommandCapture(['git', ...gitArgs], options);
  }

  try {
    return await runCommandCapture(['git', ...gitArgs], options);
  } catch (error) {
    if (!githubToken) {
      throw error;
    }
  }

  return await runCommandCapture(['git', ...buildGitHubAuthArgs(repoUrl, githubToken), ...gitArgs], options);
}

async function runCommand(
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  return await new Promise<void>((resolve, reject) => {
    const child = spawn(args[0]!, args.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${args[0]} exited with code ${code}: ${stderr.trim().slice(0, 400)}`));
    });
  });
}

async function runCommandCapture(
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(args[0]!, args.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`${args[0]} exited with code ${code}: ${stderr.trim().slice(0, 400)}`));
    });
  });
}

async function pathExists(candidatePath: string) {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function buildChangeRequestBranchName(linkedChangeRequest: LinkedChangeRequestMetadata | null, fallbackSessionId: string) {
  const requestToken = linkedChangeRequest?.requestNumber
    ? `cr-${linkedChangeRequest.requestNumber}`
    : slugifySegment(linkedChangeRequest?.id || fallbackSessionId) || fallbackSessionId;
  const titleToken = slugifySegment(linkedChangeRequest?.title || '').slice(0, 40);
  return titleToken ? `codex/${requestToken}-${titleToken}` : `codex/${requestToken}`;
}

async function gitRefExists(ref: string, cwd: string) {
  try {
    await runCommand(['git', 'rev-parse', '--verify', '--quiet', ref], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function captureGitState(cwd: string, baseBranch: string) {
  const [branchName, commitSha] = await Promise.all([
    runCommandCapture(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).catch(() => ''),
    runCommandCapture(['git', 'rev-parse', 'HEAD'], { cwd }).catch(() => ''),
  ]);

  let baseCommitSha = '';
  try {
    baseCommitSha = await runCommandCapture(['git', 'merge-base', 'HEAD', `origin/${baseBranch}`], { cwd });
  } catch {
    baseCommitSha = '';
  }

  return {
    branchName: branchName || null,
    commitSha: commitSha || null,
    baseBranch: baseBranch || null,
    baseCommitSha: baseCommitSha || null,
  };
}

async function ensureGitIdentity(cwd: string, trace: CodexRuntimeResult['trace']) {
  await runCommand(['git', 'config', 'user.name', config.gitAuthorName], { cwd });
  await runCommand(['git', 'config', 'user.email', config.gitAuthorEmail], { cwd });
  await runCommand(['git', 'config', 'author.name', config.gitAuthorName], { cwd }).catch(() => undefined);
  await runCommand(['git', 'config', 'author.email', config.gitAuthorEmail], { cwd }).catch(() => undefined);
  await runCommand(['git', 'config', 'committer.name', config.gitCommitterName], { cwd }).catch(() => undefined);
  await runCommand(['git', 'config', 'committer.email', config.gitCommitterEmail], { cwd }).catch(() => undefined);
  appendTrace(
    trace,
    'git.identity',
    `Configured git identity ${config.gitAuthorName} <${config.gitAuthorEmail}>`,
  );
}

type PreparedExecutionWorkspace = {
  workspacePath: string;
  repoUrl: string | null;
  branchName: string | null;
  commitSha: string | null;
  baseBranch: string | null;
  baseCommitSha: string | null;
};

async function prepareExecutionWorkspace(
  input: CodexRuntimeInput,
  trace: CodexRuntimeResult['trace'],
  githubToken: string | null,
) : Promise<PreparedExecutionWorkspace> {
  if (!shouldHydrateExternalWorkspace(input.metadata)) {
    return {
      workspacePath: config.codexWorkspaceRoot,
      repoUrl: null,
      branchName: null,
      commitSha: null,
      baseBranch: null,
      baseCommitSha: null,
    };
  }

  const targetApp = parseLinkedTargetApp(input.metadata);
  const targetEnvironment = parseLinkedTargetEnvironment(input.metadata);
  const linkedChangeRequest = parseLinkedChangeRequest(input.metadata);
  const linkedLatestExecution = parseLinkedLatestExecution(input.metadata);

  if (!targetApp?.repoUrl || typeof targetApp.repoUrl !== 'string') {
    appendTrace(trace, 'workspace.default', `Using default workspace ${config.codexWorkspaceRoot}`);
    return {
      workspacePath: config.codexWorkspaceRoot,
      repoUrl: null,
      branchName: null,
      commitSha: null,
      baseBranch: null,
      baseCommitSha: null,
    };
  }

  const targetSlug = slugifySegment(targetApp.slug || targetApp.name || 'target-app') || 'target-app';
  const requestSlug = linkedChangeRequest?.requestNumber
    ? `cr-${linkedChangeRequest.requestNumber}`
    : slugifySegment(linkedChangeRequest?.id || input.sessionId) || input.sessionId;
  const repoBranch =
    (typeof targetEnvironment?.branch === 'string' && targetEnvironment.branch.trim())
    || (typeof targetApp.defaultBranch === 'string' && targetApp.defaultBranch.trim())
    || 'main';
  const workspacePath = path.resolve(config.targetWorkspaceRoot, targetSlug, requestSlug);
  const gitDir = path.join(workspacePath, '.git');
  const changeRequestBranch =
    (typeof linkedLatestExecution?.branchName === 'string' && linkedLatestExecution.branchName.trim())
    || buildChangeRequestBranchName(linkedChangeRequest, input.sessionId);

  await fs.mkdir(path.dirname(workspacePath), { recursive: true });

  if (!(await pathExists(gitDir))) {
    appendTrace(trace, 'workspace.clone', `Cloning ${targetApp.repoUrl} into ${workspacePath}`);
    try {
      await runGitHubReadCommand(targetApp.repoUrl, [
        'clone',
        '--branch',
        repoBranch,
        '--single-branch',
        targetApp.repoUrl,
        workspacePath,
      ], githubToken);
    } catch (error) {
      throw await normalizeGitHubRepoError(targetApp.repoUrl, 'clone', error, githubToken);
    }
  } else {
    appendTrace(trace, 'workspace.reuse', `Reusing existing workspace ${workspacePath}`);
    const remoteOriginUrl = targetApp.repoUrl;
    await runCommand(['git', 'remote', 'set-url', 'origin', remoteOriginUrl], { cwd: workspacePath }).catch(() => undefined);
    await runGitHubReadCommand(remoteOriginUrl, ['fetch', 'origin', repoBranch, changeRequestBranch], githubToken, { cwd: workspacePath }).catch((error) => {
      appendTrace(trace, 'workspace.fetch_failed', error instanceof Error ? error.message : 'git fetch failed');
    });
  }

  const localBranchRef = `refs/heads/${changeRequestBranch}`;
  const remoteBranchRef = `refs/remotes/origin/${changeRequestBranch}`;
  const localBranchExists = await gitRefExists(localBranchRef, workspacePath);
  const remoteBranchExists = await gitRefExists(remoteBranchRef, workspacePath);

  if (localBranchExists) {
    appendTrace(trace, 'branch.checkout', `Checking out existing local branch ${changeRequestBranch}`);
    await runCommand(['git', 'checkout', changeRequestBranch], { cwd: workspacePath });

    if (remoteBranchExists) {
      appendTrace(trace, 'branch.fast_forward', `Fast-forwarding ${changeRequestBranch} from origin/${changeRequestBranch}`);
      await runCommand(['git', 'merge', '--ff-only', remoteBranchRef], { cwd: workspacePath }).catch((error) => {
        appendTrace(trace, 'branch.fast_forward_failed', error instanceof Error ? error.message : 'git ff-only merge failed');
      });
    }
  } else if (remoteBranchExists) {
    appendTrace(trace, 'branch.checkout_remote', `Creating local branch ${changeRequestBranch} from origin/${changeRequestBranch}`);
    await runCommand(['git', 'checkout', '-B', changeRequestBranch, remoteBranchRef], { cwd: workspacePath });
  } else {
    appendTrace(trace, 'branch.create', `Creating new CR branch ${changeRequestBranch} from origin/${repoBranch}`);
    await runCommand(['git', 'checkout', '-B', changeRequestBranch, `origin/${repoBranch}`], { cwd: workspacePath });
  }

  await ensureGitIdentity(workspacePath, trace);

  const gitState = await captureGitState(workspacePath, repoBranch);
  appendTrace(trace, 'workspace.ready', `Using execution workspace ${workspacePath}`);
  return {
    workspacePath,
    repoUrl: targetApp.repoUrl,
    branchName: gitState.branchName,
    commitSha: gitState.commitSha,
    baseBranch: gitState.baseBranch,
    baseCommitSha: gitState.baseCommitSha,
  };
}

function buildBranchUrl(repoUrl: string | null, branchName: string | null) {
  if (!repoUrl || !branchName) {
    return null;
  }

  const githubMatch = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!githubMatch) {
    return null;
  }

  const [, owner, repo] = githubMatch;
  return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branchName)}`;
}

async function gitHasChanges(cwd: string) {
  const status = await runCommandCapture(['git', 'status', '--porcelain'], { cwd }).catch(() => '');
  return Boolean(status.trim());
}

async function remoteBranchExists(repoUrl: string, branchName: string, cwd: string, githubToken: string | null) {
  const output = await runGitHubReadCapture(
    repoUrl,
    ['ls-remote', '--heads', repoUrl, branchName],
    githubToken,
    { cwd },
  ).catch(() => '');
  return Boolean(output.trim());
}

function buildChangeRequestCommitMessage(input: CodexRuntimeInput) {
  const linkedChangeRequest = parseLinkedChangeRequest(input.metadata);
  const requestNumber = linkedChangeRequest?.requestNumber ? `CR #${linkedChangeRequest.requestNumber}` : 'CR update';
  const title = linkedChangeRequest?.title?.trim() || input.prompt.trim().slice(0, 72) || 'workspace update';
  return `${requestNumber}: ${title}`;
}

async function finalizeGitWorkspace(
  input: CodexRuntimeInput,
  preparedWorkspace: PreparedExecutionWorkspace,
  trace: CodexRuntimeResult['trace'],
  githubToken: string | null,
) {
  if (!preparedWorkspace.repoUrl || preparedWorkspace.workspacePath === config.codexWorkspaceRoot) {
    return await captureGitState(
      preparedWorkspace.workspacePath,
      preparedWorkspace.baseBranch || 'main',
    ).catch(() => preparedWorkspace);
  }

  const workspacePath = preparedWorkspace.workspacePath;
  const currentBranch = await runCommandCapture(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspacePath })
    .catch(() => preparedWorkspace.branchName || '');

  if (!currentBranch) {
    return await captureGitState(workspacePath, preparedWorkspace.baseBranch || 'main').catch(() => preparedWorkspace);
  }

  if (await gitHasChanges(workspacePath)) {
    appendTrace(trace, 'git.commit', `Committing workspace changes on ${currentBranch}`);
    await runCommand(['git', 'add', '-A'], { cwd: workspacePath });
    await runCommand(['git', 'commit', '-m', buildChangeRequestCommitMessage(input)], { cwd: workspacePath });
  } else {
    appendTrace(trace, 'git.clean', `No uncommitted changes detected on ${currentBranch}`);
  }

  appendTrace(trace, 'git.push', `Pushing ${currentBranch} to origin`);
  try {
    await runCommand(
      ['git', ...buildGitHubAuthArgs(preparedWorkspace.repoUrl, githubToken), 'push', '-u', 'origin', currentBranch],
      { cwd: workspacePath },
    );
  } catch (error) {
    throw await normalizeGitHubRepoError(preparedWorkspace.repoUrl, 'push', error, githubToken);
  }

  const pushed = await remoteBranchExists(preparedWorkspace.repoUrl, currentBranch, workspacePath, githubToken);
  if (!pushed) {
    throw new Error(`GIT_PUSH_VERIFICATION_FAILED:${currentBranch}`);
  }
  appendTrace(trace, 'git.push_succeeded', `Verified remote branch ${currentBranch} on origin`);

  const gitState = await captureGitState(workspacePath, preparedWorkspace.baseBranch || 'main').catch(() => preparedWorkspace);
  return {
    ...gitState,
    branchUrl: buildBranchUrl(preparedWorkspace.repoUrl, gitState.branchName),
  };
}

type LoadedPrismSkills = Awaited<ReturnType<typeof loadRelevantPrismSkills>>;

function buildPrompt(
  input: CodexRuntimeInput,
  isResume: boolean,
  prismSkills: LoadedPrismSkills,
) {
  const history = input.recentHistory
    .slice(-12)
    .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`)
    .join('\n');
  const availableSkillsSummary = prismSkills.availableSkills.length
    ? prismSkills.availableSkills
      .map((skill) => `${skill.name}: ${skill.description}`)
      .join('\n')
    : null;

  const sections = [
    'You are Codex replying through a transport adapter.',
    'Behave like direct Codex chat, not like a fixed retrieval bot.',
    'Keep replies concise unless the user asks for more detail.',
    'Prism memory is optional. Only use it if it materially helps answer the user.',
    'If Prism memory is useful, query it from the shell with curl against $PRISM_API_BASE and send X-Prism-Api-Key using $PRISM_API_READ_KEY or $PRISM_API_KEY.',
    'Prism skills are authoritative when they apply. Use the loaded Prism skill instructions before probing ad hoc local paths or browser admin routes.',
    'Do not treat missing local files under /data/codex/skills, /data/workflows, or /app as a blocker for Prism-managed content. Skills, workflows, tasks, hooks, artifacts, and settings are owned by the site service and should be managed through /agent/* routes with service-token auth.',
    'Avoid unnecessary tool use. Return only the assistant reply text.',
    '',
    `External session id: ${input.sessionId}`,
    `Runtime mode: ${isResume ? 'resume' : 'start'}`,
  ];

  if (input.metadata && Object.keys(input.metadata).length) {
    sections.push(`Session metadata: ${JSON.stringify(input.metadata)}`);
  }

  if (input.capabilities?.length) {
    sections.push(
      '',
      'Organization capabilities assigned to this runtime job:',
      input.capabilities.map((capability) => JSON.stringify(capability)).join('\n'),
      'Invoke an assigned capability by POSTing JSON shaped as {"capability":"...","input":{...}} to $PRISM_RUNTIME_CAPABILITY_URL with header x-runtime-capability-token: $PRISM_RUNTIME_CAPABILITY_TOKEN.',
      'Follow each capability inputSchema. Include every required property and do not guess that a rejected request is a provider configuration failure when required input was omitted.',
      'Never print, persist, or return the runtime capability token.',
    );
  }

  if (availableSkillsSummary) {
    sections.push('', 'Available Prism skills:', availableSkillsSummary);
  }

  if (prismSkills.selectedSkills.length) {
    for (const skill of prismSkills.selectedSkills) {
      sections.push('', `Prism skill loaded: ${skill.name}`, skill.content.trim());
    }
  }

  if (!isResume && history) {
    sections.push('', 'Recent conversation:', history);
  }

  sections.push('', `Latest user message: ${input.prompt}`);
  return sections.join('\n');
}

function parseJsonEvent(rawLine: string) {
  try {
    return JSON.parse(rawLine) as {
      type?: string;
      thread_id?: string;
      message?: string;
      item?: {
        type?: string;
        text?: string;
        role?: string;
        status?: string;
      };
      error?: { message?: string } | string;
    };
  } catch {
    return null;
  }
}

function codexEventErrorMessage(event: ReturnType<typeof parseJsonEvent>) {
  if (!event) {
    return null;
  }

  if (event.type === 'error') {
    return typeof event.message === 'string'
      ? event.message
      : typeof event.error === 'string'
        ? event.error
        : event.error?.message ?? null;
  }

  if (event.type === 'turn.failed') {
    return typeof event.error === 'string' ? event.error : event.error?.message ?? null;
  }

  return null;
}

function meaningfulStderr(stderr: string) {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'Reading additional input from stdin...')
    .join('\n')
    .trim();
}

function appendTrace(
  trace: CodexRuntimeResult['trace'],
  kind: string,
  message: string,
  onTrace?: (trace: CodexRuntimeResult['trace']) => void,
) {
  trace.push({
    at: new Date().toISOString(),
    kind,
    message: message.slice(0, 500),
  });

  if (trace.length > 40) {
    trace.splice(0, trace.length - 40);
  }
  onTrace?.([...trace]);
}

function booleanMetadata(metadata: Record<string, unknown> | undefined, key: string) {
  return metadata?.[key] === true;
}

function emptyResponseFallback(input: CodexRuntimeInput) {
  if (!booleanMetadata(input.metadata, 'allowEmptyResponse')) {
    return null;
  }

  const taskKey = typeof input.metadata?.taskKey === 'string' && input.metadata.taskKey.trim()
    ? input.metadata.taskKey.trim()
    : null;
  return taskKey
    ? `Task ${taskKey} completed without returning assistant text.`
    : 'Codex completed without returning assistant text.';
}

async function runCodexProcess(input: CodexRuntimeInput) {
  const outputFile = path.join(os.tmpdir(), `codex-runtime-${randomUUID()}.txt`);
  const isResume = Boolean(input.codexThreadId);
  const trace: CodexRuntimeResult['trace'] = [];
  const prismSkills = await loadRelevantPrismSkills(input.prompt, input.metadata);
  const effectiveCapabilities = mergeSkillCapabilityRequirements(
    input.capabilities ?? [],
    prismSkills.selectedSkills,
  );
  const effectiveCredentials = Array.from(new Set([
    ...(input.credentials ?? []),
    ...prismSkills.selectedSkills.flatMap((skill) => skill.requiredCredentials),
  ]));
  const credentialLeaseKeys = effectiveCredentials;
  const lease = credentialLeaseKeys.length
    ? await gatewayClient.leaseCredentials({
        credentials: credentialLeaseKeys,
        context: input.gatewayContext || {},
      })
    : { env: {} };
  const leasedEnv = lease.env;
  const githubToken = leasedEnv.TARGET_REPO_GITHUB_TOKEN || config.githubToken;
  const preparedWorkspace = await prepareExecutionWorkspace(input, trace, githubToken);
  input.onTrace?.([...trace]);
  const executionWorkspaceRoot = preparedWorkspace.workspacePath;
  const prompt = buildPrompt({ ...input, capabilities: effectiveCapabilities }, isResume, prismSkills);
  const args = isResume
    ? ['exec', 'resume', input.codexThreadId!, '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-o', outputFile]
    : ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-o', outputFile, '-C', executionWorkspaceRoot];

  if (config.codexImageGenerationEnabled) {
    args.push('--enable', 'image_generation');
  }

  if (config.codexModel) {
    args.push('-m', config.codexModel);
  }

  args.push(prompt);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...leasedEnv,
    GIT_AUTHOR_NAME: config.gitAuthorName,
    GIT_AUTHOR_EMAIL: config.gitAuthorEmail,
    GIT_COMMITTER_NAME: config.gitCommitterName,
    GIT_COMMITTER_EMAIL: config.gitCommitterEmail,
    ...(config.codexHome ? { CODEX_HOME: config.codexHome } : {}),
    ...(config.appApiBaseUrl ? { PRISM_AGENT_API_BASE_URL: config.appApiBaseUrl } : {}),
    ...(config.appServiceToken ? { PRISM_AGENT_SERVICE_TOKEN: config.appServiceToken } : {}),
    ...(githubToken
      ? {
          TARGET_REPO_GITHUB_TOKEN: githubToken,
          GITHUB_TOKEN: process.env.GITHUB_TOKEN?.trim() || githubToken,
          GH_TOKEN: process.env.GH_TOKEN?.trim() || githubToken,
        }
      : {}),
  };
  delete env.PRISM_GATEWAY_TOKEN;
  const capabilityToken = effectiveCapabilities.length
    ? runtimeCapabilitySessions.create(
        effectiveCapabilities.map((capability) => capability.key),
        input.gatewayContext || {},
        config.codexRuntimeTimeoutMs + 60_000,
      )
    : null;
  if (capabilityToken) {
    env.PRISM_RUNTIME_CAPABILITY_URL = `http://127.0.0.1:${config.port}/v1/runtime/capabilities/invoke`;
    env.PRISM_RUNTIME_CAPABILITY_TOKEN = capabilityToken;
    env.PRISM_RUNTIME_CAPABILITIES = effectiveCapabilities.map((capability) => capability.key).join(',');
  }
  console.log(
    `[codex-runtime] spawn resume=${isResume ? 'yes' : 'no'} session=${input.sessionId} workspace=${executionWorkspaceRoot}`,
  );

  try {
    return await new Promise<CodexRuntimeResult>((resolve, reject) => {
      const child = spawn(config.codexBinary, args, {
      cwd: executionWorkspaceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdoutBuffer = '';
    let threadId = input.codexThreadId ?? null;
    let lastAgentText = '';
    let runtimeErrorMessage = '';
    let settled = false;

    const recordTrace = (kind: string, message: string) => appendTrace(trace, kind, message, input.onTrace);

    recordTrace('run.started', isResume ? 'Resuming Codex thread' : 'Starting Codex thread');

    const cancelRun = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', cancelRun);
      child.kill('SIGTERM');
      const forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 5_000);
      forceKill.unref();
      void fs.unlink(outputFile).catch(() => undefined);
      recordTrace('run.canceled', 'Codex runtime job was canceled');
      const error = new Error('RUNTIME_JOB_CANCELED') as CodexRuntimeError;
      error.codexThreadId = threadId;
      error.trace = trace;
      reject(error);
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      const error = new Error('CODEX_RUNTIME_TIMEOUT') as CodexRuntimeError;
      error.codexThreadId = threadId;
      error.trace = trace;
      recordTrace('run.timeout', 'Codex runtime timed out before completion');
      reject(error);
    }, config.codexRuntimeTimeoutMs);

    if (input.signal?.aborted) {
      cancelRun();
      return;
    }
    input.signal?.addEventListener('abort', cancelRun, { once: true });

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const event = parseJsonEvent(line.trim());
        if (!event) continue;
        if (event.type === 'thread.started' && event.thread_id) {
          threadId = event.thread_id;
          recordTrace('thread.started', `Thread ${event.thread_id} started`);
        }
        if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text?.trim()) {
          lastAgentText = event.item.text.trim();
          recordTrace('agent_message.completed', 'Assistant message completed');
        }
        if (event.type === 'item.started' && event.item?.type) {
          recordTrace('item.started', `${event.item.type} started`);
        }
        if (event.type === 'item.completed' && event.item?.type && event.item.type !== 'agent_message') {
          recordTrace('item.completed', `${event.item.type} completed`);
        }
        const eventErrorMessage = codexEventErrorMessage(event);
        if (eventErrorMessage) {
          runtimeErrorMessage = eventErrorMessage;
          const message = eventErrorMessage || 'Codex emitted an error event';
          recordTrace('runtime.error', message);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      const lines = String(chunk)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines.slice(-5)) {
        recordTrace('stderr', line);
      }
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', cancelRun);
      const runtimeError = error as CodexRuntimeError;
      runtimeError.codexThreadId = threadId;
      runtimeError.trace = trace;
      reject(error);
    });

    child.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', cancelRun);

      try {
        const outputText = await fs.readFile(outputFile, 'utf8').catch(() => '');
        await fs.unlink(outputFile).catch(() => undefined);
        const responseText = outputText.trim() || lastAgentText.trim();

        if (code !== 0) {
          recordTrace('run.failed', `Codex exited with code ${code}`);
          const failureDetails = runtimeErrorMessage || meaningfulStderr(stderr) || `Codex exited with code ${code}`;
          const error = new Error(`CODEX_RUNTIME_FAILED:${code}:${failureDetails.slice(0, 500)}`) as CodexRuntimeError;
          error.codexThreadId = threadId;
          error.trace = trace;
          reject(error);
          return;
        }

        const finalResponseText = responseText || emptyResponseFallback(input);

        if (!finalResponseText) {
          recordTrace('run.empty', 'Codex completed without returning assistant text');
          const error = new Error('CODEX_RUNTIME_EMPTY_RESPONSE') as CodexRuntimeError;
          error.codexThreadId = threadId;
          error.trace = trace;
          reject(error);
          return;
        }

        if (!responseText) {
          recordTrace('run.empty_tolerated', 'Codex completed without assistant text; returning task fallback text');
        }
        recordTrace('run.completed', 'Codex completed successfully');
        const finalGitState = await finalizeGitWorkspace(input, preparedWorkspace, trace, githubToken).catch((error) => {
          recordTrace('git.finalize_failed', error instanceof Error ? error.message : 'git finalize failed');
          throw error;
        });
        resolve({
          provider: 'codex-cli',
          model: config.codexModel,
          responseText: finalResponseText,
          codexThreadId: threadId,
          branchName: finalGitState.branchName,
          commitSha: finalGitState.commitSha,
          branchUrl: 'branchUrl' in finalGitState ? finalGitState.branchUrl ?? null : buildBranchUrl(preparedWorkspace.repoUrl, finalGitState.branchName),
          baseBranch: finalGitState.baseBranch,
          baseCommitSha: finalGitState.baseCommitSha,
          trace,
        });
      } catch (error) {
        reject(error);
      }
    });
    });
  } finally {
    if (capabilityToken) runtimeCapabilitySessions.revoke(capabilityToken);
  }
}

export async function generateCodexCliReply(input: CodexRuntimeInput) {
  if (!config.codexRuntimeEnabled) {
    throw new Error('CODEX_RUNTIME_DISABLED');
  }

  return await runCodexProcess(input);
}
