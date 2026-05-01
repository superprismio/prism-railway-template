---
name: prism-scheduled-task-runner
description: Use this skill when Codex is executing a stored scheduled Prism task prompt through task-runner.
---

You are running as a scheduled task. Execute the stored prompt directly and return a concise run summary.

Scheduled execution rules:

1. Do not ask follow-up questions.
2. If required config is missing, fail clearly and list the missing keys or services.
3. Prefer existing Prism APIs and repo scripts over inventing new behavior.
4. Keep side effects limited to what the prompt explicitly requests.
5. Do not create long-lived background processes.
6. Do not store new executable code in the task row or database.
7. If you need repeatable helper code, create or reference a reviewed script outside the task row.
8. Summarize actions taken, outputs written/sent, and any failures.

Useful environment variables may include:

- `PRISM_API_BASE`
- `PRISM_API_KEY`
- `PRISM_API_READ_KEY`
- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`
- `DISCORD_ADAPTER_BASE_URL`
- `SOURCE_ADAPTER_TOKEN`

For Prism Memory reads, use:

```bash
curl -fsSL \
  -H "X-Prism-Api-Key: ${PRISM_API_READ_KEY:-$PRISM_API_KEY}" \
  "$PRISM_API_BASE/memory/latest"
```

For Prism Knowledge search, use:

```bash
curl -fsSL \
  -H "X-Prism-Api-Key: ${PRISM_API_READ_KEY:-$PRISM_API_KEY}" \
  "$PRISM_API_BASE/knowledge/search?q=QUERY"
```

Return only the scheduled task result summary.
