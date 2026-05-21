# Script Runner Tasks

Script runner tasks are deterministic scheduled jobs for work that does not need an LLM on every run.

Use cases:

- API watchdogs and health checks
- external API pollers
- checkpoint maintenance
- cheap sync checks
- notification gates that only alert on meaningful events

## Model

Task rows use `taskType="script-runner"` and reference a registered script by key:

```json
{
  "key": "api-watchdog",
  "name": "API watchdog",
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
  "outputConfig": {}
}
```

Do not store inline JavaScript, shell, or Python in task rows. The DB stores orchestration config; executable code lives in a registered script.

## Registry

The task-runner service reads `TASK_RUNNER_SCRIPT_REGISTRY_JSON`:

```json
{
  "http-health-watchdog": {
    "command": "node",
    "args": ["/data/task-runner/scripts/http-health-watchdog.mjs"],
    "timeoutMs": 60000
  }
}
```

The runner spawns the command without a shell and sends task context as JSON on stdin.

## Script Output

Scripts should write JSON to stdout:

```json
{
  "ok": false,
  "status": "unhealthy",
  "summary": "Health check returned HTTP 503",
  "consecutiveFailures": 3,
  "shouldNotify": true,
  "shouldEscalate": true,
  "details": {
    "statusCode": 503,
    "latencyMs": 1240
  }
}
```

When `outputConfig.outputDestinations` is set, task-runner delivers the script output unless the JSON body includes `shouldNotify:false` or `notify:false`.

Escalation to workflows is intentionally separate from this first slice. A script can return `shouldEscalate:true`; a later task-runner slice can use that to create a request or trigger a workflow.
