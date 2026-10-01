// Shared authoring text, not a new runtime enforcement or delivery service.
export const escalationPolicy = `## Human-action-only Discord policy

Keep full findings, repairs, evidence, assumptions, confidence rationale, verification and rollback details in request artifacts. Discord is an escalation channel, not an activity log.

Notify only about a verified unresolved failure or blocker after applicable authorized recovery attempts have failed, or concrete evidence establishes why recovery cannot proceed, AND an exact human action is necessary. Check eligibility BEFORE delivery deduplication. A new fingerprint alone is not notification eligibility. Successful repairs, queued/running recoveries, clean scans, no-ops, retractions, disproven findings, ordinary assumptions and unknown-only evidence are silent. Do not send all-clear messages, full-report attachments or numbered report chunks unless the operator explicitly asks for a report.

Act on reasonable evidence-backed assumptions within existing authority, verify, and record the assumption internally. Do not invent a numeric confidence threshold. Stop only the affected action when confidence in its correctness is very low after investigation or a concrete prerequisite/authority boundary prevents progress. Continue independent work. Incomplete inspection evidence is not proof the target failed, and low confidence alone is not grounds to ask a human unless a specific necessary decision can be named. Never label unresolved work fixed just to close the sweep.

For each unresolved item record evidence, attempted recovery and results (or why no applicable attempt is possible), humanInterventionRequired, and exactHumanAction. Missing optional detail or routine governance uncertainty does not create a human gate. Preserve existing retry caps, cooldowns, side-effect reconciliation and authority boundaries. A bounded sweep may complete with an honest unresolved backlog; do not stall the whole sweep for an item-level question.

Before sending, persist each eligible item's alertIdentity (stable affected target, step and failure key), recoveryResult and exactHumanAction in the notification decision and accepted delivery receipt. Compare these fields with previous accepted alerts, not just the raw sweep fingerprint. Ignore timestamps, new sweep numbers and unrelated repaired items. An unchanged already-alerted blocker stays silent. An unavailable delivery history must be investigated, not treated as permission for a duplicate send.

An eligible alert is a short plain-language message: what failed and its impact; what Dreamer tried and why it did not work; exactly what the person needs to do. Include a descriptive request link for evidence. Keep hashes, UUIDs, coverage tables, raw error dumps, provenance detail and successfully resolved items in artifacts. Use only the existing authorized destination.

Persist the exact planned alert before sending. Reconcile uncertain sends against provider acceptance before retrying. Save accepted message IDs; do not resend an accepted alert merely because saving a receipt failed. A required alert's delivery failure remains retryable, never falsely delivered. Silent outcomes save a notification decision and reason without a provider message ID and must not be recorded as delivered.
`;

export const jsonArtifactPolicy = `## JSON artifact integrity

Build JSON artifact bodies with JSON.stringify(object). Parse the exact body before upload and read back and parse the saved body. Do not append the literal characters backslash+n; an actual newline is optional. Supply current agent_run_id and workflow_run_id as top-level artifact fields when known, not only inside metadata. Preserve accepted external delivery evidence if receipt persistence fails; repair the receipt without duplicating the send.
`;

export function healthReportInstructions(scopeKey) {
  return `# Save findings and escalate only when a person is needed

Read workflow-health-snapshot.json, workflow-health-findings.json, script-execution-receipt.json and workflow-health-assessment.json where available. Use corrected dispositions to save workflow-health-report.md, including coverage limitations, all evidence, retractions and unresolved items. Missing script artifacts are unknown, not proof a target failed. Keep target requests unchanged.

${escalationPolicy}
This pilot is read-only. Its lack of repair authority is NOT a reason to alert a person. Use existing recovery evidence to establish whether authorized recovery is exhausted and human intervention is necessary. Otherwise retain the finding for the normal recovery process; do not mutate or retry inspected targets.

If no eligible human-action item remains, save workflow-health-notification-decision.json with notificationRequired:false, status:suppressed_no_human_action and the reason, then complete silently. If an eligible alert is unchanged, use status:suppressed_unchanged. Do not create a human gate for an unknown finding.

For an eligible alert, compare the inspector's raw fingerprint (copied into the assessment) with GET /agent/workflow-health/deliveries?scopeKey=${scopeKey}. Also use that response's requestId to fetch GET /agent/change-board/requests/:id/artifacts and read the prior workflow-health-notification-decision.json and workflow-health-delivery-receipt.json. Compare accepted alerts by alertIdentity, recoveryResult and exactHumanAction. If the prior record predates these fields, inspect its linked report and actual accepted message before deciding whether the human ask changed. A changed raw fingerprint with unchanged accepted alert items is still suppressed_unchanged; a prior full-report recap is not automatically proof an actionable alert was sent. Save today's eligible item identities and comparison result in workflow-health-notification-decision.json even when silent. Use this same raw fingerprint in the delivery record; never substitute a corrected-disposition hash. If a failed inspector supplied no fingerprint, do not invent one: use durable prior alert/receipt evidence for deduplication and record that limitation. Only after provider acceptance POST /agent/workflow-health/deliveries with scopeKey, fingerprint, requestId, reportArtifactId and providerMessageId when a valid raw fingerprint exists. Save workflow-health-delivery-receipt.json with the accepted alert item identities as well as provider acceptance. This checkpoint is for accepted alerts only, not silent inspections.

${jsonArtifactPolicy}`;
}
