# Codex Prompt Tasks Checklist

Use this to add user-authored scheduled tasks that replay a stored prompt through `codex-runtime`.

## Target Shape

- [ ] Built-in operational tasks keep `taskType="builtin"`.
- [ ] User-authored prompt tasks use `taskType="codex-prompt"`.
- [ ] Prompt tasks store replay instructions in `instructionConfig.prompt`.
- [ ] Prompt tasks can request site-hosted skills through `instructionConfig.requestedSkills`.
- [ ] Scheduled execution records results in `task_runs`.
- [ ] Admin Tasks UI distinguishes `System` and `Custom` tasks.

## First Slice

- [ ] Add site-hosted task authoring skill.
- [ ] Add site-hosted scheduled task runner skill.
- [ ] Teach `task-runner` to fetch non-builtin task rows.
- [ ] Execute due `codex-prompt` tasks by calling `codex-runtime /v1/responses`.
- [ ] Keep custom task creation manual/API-only until execution is proven.
- [ ] Show custom/system badges in the Tasks UI.

## Prompt Task Row Shape

```json
{
  "key": "daily-memory-brief",
  "name": "Daily memory brief",
  "enabled": false,
  "triggerType": "schedule",
  "scheduleCron": "0 9 * * *",
  "timezone": "UTC",
  "taskType": "codex-prompt",
  "inputConfig": {
    "mode": "scheduled"
  },
  "instructionConfig": {
    "prompt": "Create a concise daily brief from Prism Memory and post it to the configured Discord channel.",
    "requestedSkills": [
      "prism-scheduled-task-runner",
      "prism-memory-ops"
    ]
  },
  "outputConfig": {
    "summary": true
  }
}
```

## Execution Boundary

- [ ] Store prompts/config in DB.
- [ ] Do not store arbitrary executable code in DB.
- [ ] If repeatable code is needed, create a reviewed repo or volume script and reference it from the prompt.
- [ ] Scheduled runs should not ask follow-up questions; they should fail with a clear missing-config summary.

## Later UI

- [ ] Add create task dialog.
- [ ] Add prompt editor for `codex-prompt` tasks.
- [ ] Add archive/delete for custom tasks only.
- [ ] Add chat-assisted task creation through `prism-task-author`.
