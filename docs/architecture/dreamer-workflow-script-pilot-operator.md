# Dreamer workflow-health pilot: provisioning and rollout

This implementation is code-only. It does not install a live workflow, create a
schedule, send Discord messages, or alter any existing Dreamer request. Run the
Site migration and deploy compatible Site and Task Runner versions before
registering the pilot. Rolling back to older services requires restoring an
agent-path manifest first; old workers cannot claim these script attempts.

## Prepare a reviewed revision

The reviewed source is
`services/site/scripts/dreamer-workflow-health-inspector.mjs`. Register its
exact bytes as a disabled `node-esm` task script named
`dreamer-workflow-health-inspector` through `POST /agent/task-scripts`, review
the returned full checksum, and enable only that fixed source. Then create an
immutable revision with `POST /agent/task-scripts/dreamer-workflow-health-inspector/revisions`
using `inputBinding: "workflow-health-snapshot-v1"`, `effectClass: "pure"`,
`timeoutMs: 30000`, and `outputMaxBytes: 262144`. Record the returned revision
ID and full checksum. Revisions retain source when the mutable task-script
authoring record changes. A disabled current script blocks new claims.

## Prepare, but do not enable, the workflow

Run `node services/site/scripts/build-dreamer-workflow-health-pilot.mjs` with
`--revision-id=… --checksum=sha256:… --workflow-keys=key1,key2
--scope-key=… --dreamer-profile=… --accountability-domain=…` to print a
reviewable `/agent/workflows` POST payload. Supply the instance's real Dreamer
profile and accountability domain; do not use the Admin fallback. Edit the
`requiredArtifacts` mapping to explicit names for each eligible workflow.
Empty lists mean “no artifact rule configured,” not “all artifacts optional.”
The generated payload has `enabled:false` and creates no task.

For a manual run, enable the reviewed workflow after deployment and create a
request whose `constraints.workflowHealth.requestNumbers` contains up to 25
explicit positive request numbers. The script does not discover or sweep all
requests. The snapshot reports truncated selection and missing/ineligible
targets as partial coverage. It reads metadata only, never provider bodies or
secrets, and does not repair target requests. The command-receipt check is
conservative: absent same-attempt receipts are unknown, not proof a command
failed. Lease audit currently reports `not_available` unless non-secret audit
references are added later; credential diagnoses stay unknown.

The normal route for a finding is inspection → Dreamer's evidence assessment →
full report → close. The assessment checks the original request review and
named artifact APIs, and records confirmed, disproven, and unresolved checks.
An unlinked artifact is unresolved until its run provenance is verified; a
disproven missing-artifact finding is retracted in the report. Incomplete
evidence or contract failure uses the same assessment step.
Discord is human-action-only: successful recoveries, clean scans, unknown-only
evidence and retractions stay in the full request report without a notification.
An alert requires a verified unresolved failure, exhausted applicable authorized
recovery (or a concrete reason it cannot proceed), and an exact human action.
The read-only pilot's lack of repair authority is not itself an escalation reason.
Eligible alerts briefly explain what failed, what was tried and what the person
must do, with a request link. Do not push full reports, UUIDs or fingerprints to
Discord. Save a notification decision for silent outcomes; do not mark them delivered.
Reconcile uncertain delivery and record a receipt only after provider acceptance. The Site
delivery fingerprint is updated through `/agent/workflow-health/deliveries`
after provider acceptance, never before. No second notification stream or
recurring task is created by this implementation.

When adopting this policy on an existing instance, replace conflicting notification
instructions in Dreamer's profile, recovery workflow and maintenance verification
step as well as this pilot. Do not merely prepend another policy to instructions
that still require success recaps or full-report Discord delivery. Preserve all
existing repair authority, destinations, retry limits and schedules. Suppression
must be based on the human-action decision first; for eligible alerts compare the
prior accepted alert's stable identity, recovery result and human ask, even when
the raw sweep fingerprint changes. Store those fields in decision/receipt artifacts.

After deploying a change to the inspector source, register a new immutable
script revision with the new checksum and update the instance-owned workflow
manifest to that revision. Also update the instance-owned assessment and report
step instructions from the generated payload. Code deployment alone does not
replace the live revision or workflow files. Keep canary #3263 as historical
evidence; run a new canary after updating the instance.

The inspector's raw observation fingerprint is the delivery deduplication key
through assessment and reporting. Dreamer corrects the human-readable findings
after checking original evidence, but copies that fingerprint unchanged into
the assessment and delivery record. This keeps an identical observation quiet
on the next run.

Legacy artifact metadata links (`agent_run_id` / `agentRunId`) are accepted only
after a same-request agent-to-workflow join, and never override canonical links.
Serialize JSON artifacts with `JSON.stringify`, parse before upload and verify
the saved content parses; literal trailing backslash-n characters are invalid JSON.

Validate a clean/no-op request, a changed finding, incomplete evidence,
interruption and retry, fallback, stop, and restored agent-path manifest in a
canary before scheduling. Shadow-run at least ten representative requests and
record coverage gaps, latency, fallback rate, tokens, and end-to-end cost.
Only then consider attaching this step to an existing Dreamer lifecycle.
