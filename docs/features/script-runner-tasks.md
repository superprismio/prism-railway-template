# Script Runner Tasks

Script runner tasks are deterministic scheduled jobs for work that does not need an LLM on every run.

Use cases:

- API watchdogs and health checks
- external API pollers
- checkpoint maintenance
- cheap sync checks
- notification gates that only alert on meaningful events

## Model

Task rows use `taskType="script-runner"` and reference a site-owned task script by key:

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
  "agentConfig": {
    "gatewayToolsets": ["example.read"]
  },
  "outputConfig": {}
}
```

Do not store inline JavaScript, shell, or Python in task rows. The task row stores orchestration config; executable code lives in a site-owned task script managed through `/agent/task-scripts`.

`params` are non-secret task inputs. When a script needs an organization
credential, assign an adapter connected service through
`agentConfig.gatewayToolsets` and read its declared environment variable from
`process.env`. Task Runner leases those values for one execution and exposes
them only to the child process. It fails the task if an assigned lease cannot be
obtained; it does not fall back to credentials embedded in params or script
content.

## Task Script

Create the script through the site service before creating or enabling the task:

```json
{
  "key": "http-health-watchdog",
  "name": "HTTP health watchdog",
  "runtime": "node-esm",
  "enabled": true,
  "timeoutMs": 60000,
  "content": "let raw = ''; for await (const chunk of process.stdin) raw += chunk; const input = JSON.parse(raw); console.log(JSON.stringify({ ok: true, summary: `Checked ${input.params.url}` }));"
}
```

The site stores script metadata in the DB and script content in site-managed storage. The runner fetches `/agent/task-scripts/:key/content`, executes the script ephemerally without a shell, and sends task context as JSON on stdin.

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
  },
  "agentConfig": {
    "gatewayToolsets": ["example.read"]
  }
}
```

`params` are non-secret task inputs. When a script needs an organization
credential, assign an adapter connected service through
`agentConfig.gatewayToolsets` and read its declared environment variable from
`process.env`. Task Runner leases those values for one execution and exposes
them only to the child process. It fails the task if an assigned lease cannot be
obtained; it does not fall back to credentials embedded in params or script
content.

When `outputConfig.outputDestinations` is set, task-runner delivers the script output unless the JSON body includes `shouldNotify:false` or `notify:false`.

For destination messages, task-runner prefers `responseText`, `output_text`, `summary`, `message`, or `text` before falling back to raw JSON. Prefer `summary` for human-readable watchdog alerts.

Script stdout and stderr capture is bounded by `TASK_RUNNER_SCRIPT_OUTPUT_MAX_BYTES`, and timed-out scripts receive `SIGTERM` followed by `SIGKILL` after `TASK_RUNNER_SCRIPT_KILL_GRACE_MS`.

Escalation to workflows is intentionally separate from this first slice. A script can return `shouldEscalate:true`; a later task-runner slice can use that to create a request or trigger a workflow.
