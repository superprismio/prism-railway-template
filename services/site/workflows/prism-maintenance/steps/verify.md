# Verify

Save a follow-up report with Repairs, Verification, Assumptions to review,
Unresolved items, and Rollback references. Each applied assumption must say
"This was an assumption and should be reviewed", identifying the exact change
and reason. An assumption with successful verification does not itself block
completion; verification is evidence of correctness, not proof of operator
agreement. Never describe unavailable checks as passed.

When the instance supplies an explicit maintenance report destination, send a
secret-free full maintenance report there after saving the report artifact, including
partial outcomes and explicit questions for unresolved items. This
is authorized maintenance reporting, not authorization for arbitrary external
publishing. Save the provider message ID and request external reference; on
retry reconcile the delivery receipt before sending again. If delivery fails,
preserve the completed repairs and report the delivery failure separately.

## Report delivery is the deliverable

Create maintenance-report.md from the plan, repair receipts, fresh Doctor output
and unresolved backlog. Include exact affected workflow/step keys, before/after
changes, verification results and limitations, each assumption and its rationale,
each unresolved finding with attempted action and concrete next action/question,
and rollback artifact references. Separate remaining automated work from questions
only an operator can answer. Do not ask for blanket permission to do authorized
repairs. Report finding counts separately from distinct target counts.

Deliver a short introduction PLUS the full readable report. Use a file attachment
only when the adapter documents support; otherwise send the complete report as
ordered, labeled message parts within the provider limits. Never invent upload
fields or treat artifact filenames, an inbox link, or a high-level recap as report
delivery. Keep internal secrets and unnecessary private source data out of the
report. Include the request URL for supporting evidence, not as a substitute.

Persist the report artifact ID, content hash, delivery mode, expected part count,
and all provider-accepted message IDs in maintenance-report-delivery.json. Resume
only missing parts on retry, reconciling uncertain sends before resending. Do not
claim report delivery until the attachment or every full-report part is accepted.

Read the maintenance plan and receipts. Trigger the existing prism-doctor task through POST /agent/tasks/prism-doctor/trigger, then read /agent/tasks/runs?taskKey=prism-doctor for a fresh completed report newer than the repairs. Reconcile an already-running Doctor rather than duplicate it. If it has not completed within a bounded check, return retryable needs_attention; never claim stale evidence proves a fix.

Save maintenance-verification.md with before/after finding counts and per-item outcomes. Also save maintenance-unresolved.json with stable finding IDs, affected targets, evidence, attempted actions, why each remains unresolved, exact questions or required actions, and conditions for retry. Count findings and distinct workflows separately from these records. This completion contract explicitly authorizes deferral of unresolved items to the delivered report. Do not return needs_attention solely because Doctor still has failures, credentials are missing, or a human answer is pending. After durable report delivery, return a successful step outcome stating "Maintenance batch completed with unresolved findings reported" and allow normal routing to Closed. Closed describes the batch, not resolution of every finding. Never mark missing checks or deferred findings as passed. A failed report delivery remains a retryable technical failure; do not close until the delivery is confirmed. Do not execute repository code review or unrelated publishing merely to close this maintenance ticket.

Verify each installed delta by readback and targeted checks as well as the fresh
Doctor report. Report partial progress clearly: repaired, already resolved,
blocked, failed verification, and proposed optimization. Never describe a
connection inventory as empty because one legacy field is empty. Remaining
blocked items should name the exact operator action; they must not erase credit
or receipts for completed repairs. On a retry, reconcile existing receipts and
current versions rather than repeat successful writes.
