#!/usr/bin/env node
// Produces a disabled, reviewable /agent/workflows payload. It makes no API calls.
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
      { key: 'report-results', label: 'Report meaningful changes', type: 'agent',
        executorAgent: args['dreamer-profile'], agentConfig: { skills: ['change-request-ops', 'discord-send'] },
        instructionPath: 'steps/report-results.md', next: 'closed' },
      { key: 'closed', label: 'Closed', type: 'terminal' },
    ],
  };
  const files = {
    'workflow.md': `# Dreamer workflow health pilot\n\nThis is a read-only inspection of up to 25 explicit request numbers supplied in request constraints.workflowHealth.requestNumbers. The script has no provider access and no target-write authority. The workflow is disabled until manually validated. A script no-op closes quietly.\n`,
    'steps/assess-findings.md': `# Verify workflow health findings\n\nRead this request's workflow-health-snapshot.json, workflow-health-findings.json, and script-execution-receipt.json. A failed script may have no findings artifact; state that as unknown. For each reported missing required artifact, read the target's original GET /agent/change-board/requests/by-number/:number/review and GET /agent/change-board/requests/by-number/:number/artifacts?name=<encoded-name>. Compare the artifact's explicit workflow run or same-request agent run linkage to the inspected workflow run. A same-name artifact without provable run provenance remains unresolved; an artifact from another run or request does not satisfy the rule. Recheck other findings against original evidence when possible. Do not infer absence from an empty or inaccessible snapshot.\n\nSave workflow-health-assessment.json and workflow-health-assessment.md on this inspection request. For every raw finding and unknown, record the original check key, corrected disposition (confirmed, disproven, or unresolved), original target number, run ID, relevant artifact or attempt IDs, source API references, and reason. A verified artifact disproves a missing-artifact finding. An inaccessible source remains unresolved. Copy the inspector's raw fingerprint verbatim into the assessment for delivery deduplication; do not calculate another fingerprint from corrected dispositions. Identify retractions from earlier reports. This assessment is the source for the report; preserve the script findings as raw audit evidence. Keep target requests unchanged and continue to report-results. Do not create a human gate for uncertainty.\n`,
    'steps/report-results.md': `# Report verified workflow health\n\nRead workflow-health-snapshot.json, workflow-health-findings.json, script-execution-receipt.json, and workflow-health-assessment.json. Use the assessment's corrected dispositions, not raw script findings, to produce the full workflow-health-report.md artifact linked to this request. Include selected-request coverage, every confirmed and unresolved item with request/run/receipt references, disproven findings and retractions, assumptions to review, and any errors. Never present a disproven missing artifact as a current finding or claim a partial sweep was complete. Do not change target requests.\n\nBefore notifying Discord, compare the inspector's raw fingerprint, copied verbatim into the assessment, with the last confirmed delivery for scope ${args['scope-key']}. If unchanged, finish silently. Use this same raw fingerprint in the delivery record; do not substitute a corrected-disposition hash. For meaningful change, use the authorized Dreamer channel binding to attach the full report or link its durable artifact; a short recap alone is insufficient. On transport uncertainty, reconcile prior delivery before resending. Only after Discord confirms acceptance with a provider message ID, POST /agent/workflow-health/deliveries with scopeKey, fingerprint, requestId, reportArtifactId and providerMessageId. Save the delivery receipt artifact. If delivery fails, leave this step retryable and do not mark the fingerprint delivered. Never expose service credentials in the report.\n`,
  };
  process.stdout.write(`${JSON.stringify({ key, enabled: false, accountabilityDomainKey: args['accountability-domain'], manifest, files }, null, 2)}\n`);
}
