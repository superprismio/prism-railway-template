# Verify

Read the maintenance plan and receipts. Trigger the existing prism-doctor task through POST /agent/tasks/prism-doctor/trigger, then read /agent/tasks/runs?taskKey=prism-doctor for a fresh completed report newer than the repairs. Reconcile an already-running Doctor rather than duplicate it. If it has not completed within a bounded check, return retryable needs_attention; never claim stale evidence proves a fix.

Save maintenance-verification.md with before/after finding counts and per-item outcomes. Close only when failed findings are resolved or an explicit operator-approved narrowed scope/deferment is documented; remaining warnings must be explained. Credential-entry and policy blockers stay visible and retryable. Do not execute repository code review or publish externally merely to close this maintenance ticket.

Verify each installed delta by readback and targeted checks as well as the fresh
Doctor report. Report partial progress clearly: repaired, already resolved,
blocked, failed verification, and proposed optimization. Never describe a
connection inventory as empty because one legacy field is empty. Remaining
blocked items should name the exact operator action; they must not erase credit
or receipts for completed repairs. On a retry, reconcile existing receipts and
current versions rather than repeat successful writes.
