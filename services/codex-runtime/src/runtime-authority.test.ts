import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCodexArgs, buildCodexChildEnvironment, buildPrompt } from './codex-runtime.js';

test('read-only utility invocation uses a read-only sandbox without bypass flags', () => {
  const args = buildCodexArgs(
    { authorityMode: 'read_only_utility', codexThreadId: 'must-not-resume' },
    '/tmp/answer.txt',
    '/workspace',
  );

  assert.deepEqual(args.slice(0, 2), ['exec', '--json']);
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!args.includes('workspace-write'));
  assert.ok(!args.includes('danger-full-access'));
  assert.ok(!args.includes('resume'));
  assert.ok(args.includes('mcp_servers={}'));
  for (const feature of [
    'shell_tool', 'unified_exec', 'code_mode_host', 'browser_use', 'computer_use',
    'apps', 'enable_mcp_apps', 'hooks', 'image_generation', 'multi_agent', 'multi_agent_v2',
    'remote_plugin', 'plugin_sharing', 'skill_mcp_dependency_install', 'tool_suggest',
    'auth_elicitation', 'tool_call_mcp_elicitation',
  ]) {
    const index = args.indexOf(feature);
    assert.ok(index > 0, `${feature} must be explicitly disabled`);
    assert.equal(args[index - 1], '--disable');
  }
});

test('read-only utility prompt does not advertise Site mutation routes or skills', () => {
  const composed = buildPrompt({
    prompt: 'Explain the supplied evidence.',
    recentHistory: [],
    sessionId: 'utility-session',
    authorityMode: 'read_only_utility',
    metadata: {},
  }, false, { availableSkills: [], selectedSkills: [] });

  assert.match(composed.prompt, /runtime-enforced read-only utility invocation/);
  assert.doesNotMatch(composed.prompt, /\/agent\/\*/);
  assert.doesNotMatch(composed.prompt, /service-token auth/);
  assert.doesNotMatch(composed.prompt, /PRISM_API_KEY/);
});

test('read-only utility child receives provider auth but no mutation credentials', () => {
  const env = buildCodexChildEnvironment('read_only_utility', {
    PATH: '/bin',
    HOME: '/runtime-home',
    OPENAI_API_KEY: 'provider-secret',
    PRISM_AGENT_SERVICE_TOKEN: 'site-secret',
    APP_API_SERVICE_TOKEN: 'app-secret',
    INTERNAL_SERVICE_TOKEN: 'internal-secret',
    PRISM_ADMIN_PASSWORD: 'admin-secret',
    PRISM_INTERFACE_KEY: 'interface-secret',
    COMMUNICATION_ADAPTER_TOKEN: 'adapter-secret',
    PRISM_GATEWAY_TOKEN: 'gateway-secret',
    TARGET_REPO_GITHUB_TOKEN: 'repo-secret',
    GITHUB_TOKEN: 'github-secret',
    GH_TOKEN: 'gh-secret',
  }, {
    CRM_WRITE_TOKEN: 'leased-secret',
  }, 'repo-secret');

  assert.equal(env.OPENAI_API_KEY, 'provider-secret');
  assert.equal(env.PATH, '/bin');
  for (const key of [
    'PRISM_AGENT_SERVICE_TOKEN', 'APP_API_SERVICE_TOKEN', 'INTERNAL_SERVICE_TOKEN',
    'PRISM_ADMIN_PASSWORD', 'PRISM_INTERFACE_KEY', 'COMMUNICATION_ADAPTER_TOKEN',
    'PRISM_GATEWAY_TOKEN', 'TARGET_REPO_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN',
    'CRM_WRITE_TOKEN',
  ]) {
    assert.equal(env[key], undefined, `${key} must not reach a read-only utility child`);
  }
});

test('full authority preserves legacy bypass and credential behavior', () => {
  const args = buildCodexArgs(
    { authorityMode: 'full', codexThreadId: null },
    '/tmp/answer.txt',
    '/workspace',
  );
  const env = buildCodexChildEnvironment('full', {
    PATH: '/bin',
    APP_API_SERVICE_TOKEN: 'app-secret',
    GITHUB_TOKEN: 'github-secret',
  }, { CRM_WRITE_TOKEN: 'leased-secret' }, 'repo-secret');

  assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!args.includes('--sandbox'));
  assert.equal(env.APP_API_SERVICE_TOKEN, 'app-secret');
  assert.equal(env.CRM_WRITE_TOKEN, 'leased-secret');
  assert.equal(env.TARGET_REPO_GITHUB_TOKEN, 'repo-secret');
  assert.equal(env.GITHUB_TOKEN, 'github-secret');
});
