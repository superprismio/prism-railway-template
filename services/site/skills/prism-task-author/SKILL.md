---
name: prism-task-author
description: Use this skill when Codex is asked to design or create a scheduled Prism task from a user's natural-language request.
---

Use this skill to turn a user's task idea into a durable Prism task definition.

Task authoring rules:

1. Prefer `taskType="codex-prompt"` for user-authored scheduled prompt tasks.
2. Use `taskType="workflow-runner"` when the task should create a durable request and run it through a workflow.
3. Use `taskType="script-runner"` for deterministic watchdogs, pollers, API checks, checkpoint updates, and other jobs that should avoid LLM calls by default.
4. Store replayable natural-language instructions in `instructionConfig.prompt` for `codex-prompt` and `workflow-runner` tasks.
5. Store optional skill names in `instructionConfig.requestedSkills`.
6. Store schedule in `scheduleCron` using standard five-field cron syntax.
7. Default new tasks to `enabled=false` unless the user explicitly asks to enable it after review.
8. Do not store arbitrary JavaScript, Python, or shell code in the task row.
9. If deterministic repeatable code is needed, create or verify a site-owned task script through `/agent/task-scripts` first, then reference it with `inputConfig.scriptKey` and structured `inputConfig.params`.
10. Include required destination/config assumptions in `inputConfig` or `outputConfig`.
11. If the user asks to send output to a destination such as Discord `#updates` or a Telegram group, resolve the destination during task creation when possible. Use `availableOutputDestinations` from session metadata first. Store resolved destinations in `outputConfig.outputDestinations`; do not leave channel matching for scheduled run time if the channel can be resolved now.
12. A resolved output destination must include `adapter`, `type`, `id`, and `label`. If you only know the label, the destination is unresolved.
13. If a requested destination cannot be resolved, create the task disabled and state that delivery is unresolved.
14. When a task creates a request from an outside system, attach that source as a request external ref when the API is available. Examples: GitHub issue collector tasks attach the source issue, Discord support triage tasks attach the source message or thread, and publishing tasks attach the final CMS post.

Workflow-runner request types must use one of: `bug`, `feature`, `issue`, `content`, `design`, `config`, or `ops`. Use `issue` for imported GitHub issues or issue-like support intake when the source item itself is the request.

Recommended task row shape:

```json
{
  "key": "daily-memory-brief",
  "name": "Daily memory brief",
  "description": "Generate and send a daily Prism Memory brief.",
  "enabled": false,
  "triggerType": "schedule",
  "scheduleCron": "0 9 * * *",
  "timezone": "UTC",
  "taskType": "codex-prompt",
  "inputConfig": {
    "mode": "scheduled"
  },
  "instructionConfig": {
    "prompt": "Create a concise daily brief from Prism Memory. Return only the brief text and a short source summary.",
    "requestedSkills": ["prism-scheduled-task-runner", "prism-memory-ops"]
  },
  "outputConfig": {
    "summary": true,
    "outputDestinations": [
      {
        "adapter": "discord",
        "type": "discord-channel",
        "id": "discord:1234567890",
        "label": "#updates"
      },
      {
        "adapter": "telegram",
        "type": "telegram-chat",
        "id": "telegram:-1001234567890",
        "label": "Telegram / RaidGuild Updates"
      }
    ]
  }
}
```

Workflow runner task shape:

```json
{
  "key": "weekly-blog-workflow",
  "name": "Weekly blog workflow",
  "description": "Create a weekly blog request and run the workflow until the next gate or checkpoint.",
  "enabled": false,
  "triggerType": "schedule",
  "scheduleCron": "0 16 * * 5",
  "timezone": "UTC",
  "taskType": "workflow-runner",
  "inputConfig": {
    "workflowKey": "blog-post-draft-review-publish",
    "request": {
      "title": "Weekly blog post",
      "description": "Create this week's blog post from Prism Memory and Knowledge.",
      "requestType": "content",
      "priority": "normal"
    },
    "autoRun": {
      "enabled": true,
      "maxSteps": 1,
      "stopStatuses": ["closed"]
    }
  },
  "instructionConfig": {
    "prompt": "Run the current workflow step using the request description and workflow step instructions."
  },
  "outputConfig": {}
}
```

Workflow-runner tasks create requests through `/agent/change-board/requests`. When `inputConfig.autoRun.enabled` is true, the created request should start automatically if the workflow entry step is an agent step. If the entry step is a gate or checkpoint, it waits for an operator decision/check.

Script runner task shape:

```json
{
  "key": "api-watchdog",
  "name": "API watchdog",
  "description": "Check an API and only notify when unhealthy.",
  "enabled": false,
  "triggerType": "schedule",
  "scheduleCron": "*/10 * * * *",
  "timezone": "UTC",
  "taskType": "script-runner",
  "inputConfig": {
    "scriptKey": "http-health-watchdog",
    "params": {
      "url": "https://example.com/health",
      "expectedStatus": 200,
      "unhealthyThreshold": 3
    },
    "timeoutMs": 60000
  },
  "instructionConfig": {},
  "outputConfig": {
    "outputDestinations": [
      {
        "adapter": "discord",
        "type": "discord-channel",
        "id": "discord:1234567890",
        "label": "#ops"
      }
    ]
  }
}
```

For script-runner tasks, the script itself must be a site-owned task script available through `/agent/task-scripts/:key/content`. Do not rely on local Codex Runtime files, repo-only files, or task-runner env registries for scheduled execution. The task row only references `scriptKey` and passes structured params. Scripts should write JSON to stdout and may include `shouldNotify:false` to suppress configured output delivery for healthy/no-op runs.

Create or update a task script before creating the scheduled task:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/task-scripts" \
  -d "$TASK_SCRIPT_JSON"
```

Use `runtime="node-esm"` for script-runner scripts. A script receives JSON on stdin with `task`, `scriptKey`, `params`, `inputConfig`, `outputConfig`, `agentConfig`, and `triggeredAt`.

When creating a task through the Prism API, use the site internal task endpoint if credentials are available:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/tasks" \
  -d "$TASK_JSON"
```

Do not use `/admin/tasks` from Codex Runtime. That route is for the browser admin UI and requires an authenticated admin session, so `401 Unauthorized` there does not mean task creation is unavailable. Runtime agents should use `/agent/tasks` with `x-service-token`.

In deployed Prism instances, Codex Runtime usually receives `APP_API_BASE_URL` and `APP_API_SERVICE_TOKEN`, and exposes them to Codex as `PRISM_AGENT_API_BASE_URL` and `PRISM_AGENT_SERVICE_TOKEN`. If the `PRISM_*` names are not present, check the `APP_*` names before concluding the task API is unavailable.

Return a concise review summary with:

- task key
- schedule
- whether it is enabled
- required env/config
- resolved output destinations, if any
- what the scheduled prompt, workflow, or script will do
