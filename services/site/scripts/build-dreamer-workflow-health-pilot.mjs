#!/usr/bin/env node
// Produces a disabled, reviewable /agent/workflows payload. It makes no API calls.
import { escalationPolicy, healthReportInstructions, jsonArtifactPolicy } from './dreamer-reporting-policy.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
const required = ['revision-id', 'checksum', 'workflow-keys', 'scope-key', 'dreamer-profile', 'accountability-domain'];
const missing = required.filter((key) => !args[key]);
if (missing.length) {
  process.stderr.write(`Missing --${missing.join(', --')}; all arguments use --name=value. No changes made.\n`);
  process.exitCode = 2;
} else {
  const key = 'dreamer-workflow-health-pilot';
  const workflowKeys = args['workflow-keys'].split(',').map((value) => value.trim()).filter(Boolean);
  const requiredArtifacts = {};
  for (const workflowKey of workflowKeys) requiredArtifacts[workflowKey] = [];
  const manifest = {
    key, name: 'Dreamer workflow health pilot', version: 1,
    description: 'Read-only, request-owned workflow health inspection. No target repairs or scheduled launch.',
    entrypoint: 'inspect-evidence', defaultAgent: args['dreamer-profile'],
    agentConfig: { contextPolicy: { continuation: 'step', handoff: 'artifacts' } },
    steps: [
      { key: 'inspect-evidence', label: 'Inspect evidence', type: 'script',
        scriptConfig: { scriptKey: 'dreamer-workflow-health-inspector', revisionId: args['revision-id'],
          checksum: args.checksum, contractVersion: 1, inputBinding: 'workflow-health-snapshot-v1',
          effectClass: 'pure', timeoutMs: 30_000, outputMaxBytes: 262_144,
          eligibleWorkflowKeys: workflowKeys, requiredArtifacts, windowHours: 24,
          reportScopeKey: args['scope-key'], fallbackStepKey: 'assess-findings', noOpNextStepKey: 'closed' },
        next: 'assess-findings' },
      { key: 'assess-findings', label: 'Assess incomplete findings', type: 'agent',
        executorAgent: args['dreamer-profile'], agentConfig: { skills: ['change-request-ops'] },
        instructionPath: 'steps/assess-findings.md', next: 'report-results' },
      { key: 'report-results', label: 'Save report / escalate if needed', type: 'agent',
        executorAgent: args['dreamer-profile'], agentConfig: { skills: ['change-request-ops', 'discord-send'] },
        instructionPath: 'steps/report-results.md', next: 'closed' },
      { key: 'closed', label: 'Closed', type: 'terminal' },
    ],
  };
  const files = {
    'workflow.md': `# Dreamer workflow health pilot\n\nThis is a read-only inspection of up to 25 explicit request numbers supplied in request constraints.workflowHealth.requestNumbers. The script has no provider access and no target-write authority. The workflow is disabled until manually validated. A script no-op closes quietly.\n`,
    'steps/assess-findings.md': `# Verify workflow health findings\n\nRead this request's workflow-health-snapshot.json, workflow-health-findings.json, and script-execution-receipt.json. A failed script may have no findings artifact; state that as unknown. For each reported missing required artifact, read the target's original GET /agent/change-board/requests/by-number/:number/review and GET /agent/change-board/requests/by-number/:number/artifacts?name=<encoded-name>. Compare the artifact's explicit workflow run or same-request agent run linkage to the inspected workflow run. A same-name artifact without provable run provenance remains unresolved; an artifact from another run or request does not satisfy the rule. Recheck other findings against original evidence when possible. Do not infer absence from an empty or inaccessible snapshot.\n\nSave workflow-health-assessment.json and workflow-health-assessment.md on this inspection request. For every raw finding and unknown, record the original check key, corrected disposition (confirmed, disproven, or unresolved), original target number, run ID, relevant artifact or attempt IDs, source API references, and reason. A verified artifact disproves a missing-artifact finding. An inaccessible source remains unresolved. Copy the inspector's raw fingerprint verbatim into the assessment for delivery deduplication; do not calculate another fingerprint from corrected dispositions. Identify retractions from earlier reports. This assessment is the source for the report; preserve the script findings as raw audit evidence. Keep target requests unchanged and continue to report-results. Do not create a human gate for uncertainty.\n`,
    'steps/report-results.md': healthReportInstructions(args['scope-key']),
  };
  files['workflow.md'] += `\n${escalationPolicy}`;
  files['steps/assess-findings.md'] += `\nLegacy metadata.agent_run_id or metadata.agentRunId can establish provenance only by a verified same-request agent-run to inspected-workflow-run link. Canonical linkage takes precedence; conflicting aliases remain unresolved. For each unresolved item, record recovery attempts/results or concrete inability, humanInterventionRequired, and exactHumanAction. Read-only inspection does not authorize recovery and is not itself grounds for human escalation.\n\n${escalationPolicy}\n${jsonArtifactPolicy}`;
  process.stdout.write(`${JSON.stringify({ key, enabled: false, accountabilityDomainKey: args['accountability-domain'], manifest, files }, null, 2)}\n`);
}
