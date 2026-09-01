---
name: prism-doctor
description: Use this skill when Codex needs to interpret Prism Doctor reports, explain workflow/task/hook drift, or plan deliberate repairs without mutating instance content by default.
---

Use this skill to interpret Prism Doctor output and plan repairs.

Prism Doctor is report-only by default. Do not mutate workflows, tasks, hooks,
skills, requests, or instance configuration unless the operator explicitly asks
for a repair action after reviewing the report.

Doctor principles:

1. Check whether Prism content follows the intended operating model.
2. Prefer structural correctness over string matching.
3. Treat workflows as deterministic, observable, and repairable engine inputs.
4. Treat tasks and hooks as references to workflows; if the referenced workflow
   has findings, the task or hook inherits operational risk.
5. Recommend exact repairs, but do not apply them automatically.

Current workflow checks:

- gates have one forward `next`;
- gates do not rely on `routes`;
- non-terminal non-loop steps have a valid forward `next`;
- loop steps have `loop.target`, `next`, and positive `loop.maxIterations`;
- referenced step keys exist.
- referenced skills exist;
- shared workflow skills are reviewed when they expand multiple agent steps;
- adjacent agent steps with different effective skill sets have an explicit
  artifact handoff and either `contextPolicy.continuation: step` with
  `handoff: artifacts`, or a gate/checkpoint justified by a real decision;
- skill-declared Gateway credentials exist and contain secret values;
- direct workflow and task Gateway credentials exist and contain secret values.
- workflow manifests do not declare legacy Gateway toolset or capability fields;
- inline and file-backed workflow instructions do not require legacy admin
  toolset keys or `PRISM_RUNTIME_TOOLSET_*` variables.

Current accountability checks come from `GET /agent/accountability/audit`:

- every Agent Profile, workflow, and task has exactly one active domain;
- each domain identifies its stewards;
- every workflow agent step resolves to an active profile;
- resolution source is recorded as step explicit, workflow default, task
  explicit, hook workflow default, Admin fallback, historical unknown, or not
  applicable;
- Admin fallback is reported separately from an explicit Admin assignment;
- intentional cross-domain execution is visible;
- recent run snapshots include definition version/domain and executor
  profile-version/domain when applicable.

Do not treat cross-domain execution as a failure by itself. Fail a check when the
executor cannot resolve, a definition is unassigned, a referenced domain is
archived, or a prospective run omits required provenance. Report Admin fallback
as debt with an exact definition and step/task key.

Doctor does not infer downstream RBAC or duplicate provider policy.

When summarizing a report:

1. Lead with failed workflow checks.
2. Call out enabled hooks or tasks that reference workflows with failures.
3. Separate built-in workflow drift from custom instance workflow drift.
4. Recommend a small repair order.
5. Treat a missing credential as a blocker to removing the corresponding legacy
   runtime credential.
6. Mention that Doctor did not mutate content.
7. Separate definition ownership findings from executor provenance findings.

When Doctor or a repair workflow finds a completed/closed request whose
terminal workflow run (completed or canceled) projects a non-terminal current
step, use the documented by-number workflow reconciliation route. Dry-run it
first. The route only corrects terminal projection drift; it does not execute
steps, rerun work, or repair active requests.

Useful commands:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/tasks"

curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/accountability/audit"
```

Manual runs are started from the Task Runner UI or the task-runner service
`POST /tasks/prism-doctor/run` endpoint when the task-runner token is available.
