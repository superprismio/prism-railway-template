# Safe Patch Examples

Read only the `agentic_ingest` section:

- First call `GET /config/space`
- Then return only `config.agentic_ingest` with a short explanation

Summarize current config:

- First call `GET /config/space`
- Then summarize:
  - timezone
  - enabled collectors
  - whether knowledge is enabled
  - whether agentic ingest is enabled
  - any notable non-default sections
- Do not dump the full JSON unless explicitly asked

Enable agentic ingest for bot-only classification:

```json
{
  "patch": {
    "agentic_ingest": {
      "mode": "bot_only",
      "scope": "bot_only",
      "provider": {
        "base_url": "http://codex-runtime.railway.internal:3030/v1",
        "model": "gpt-5.5"
      }
    }
  }
}
```

Important:

- `mode=on` is invalid
- use `mode=bot_only` for the first enabled rollout

Add policy guidance for important and low-signal discussions:

```json
{
  "patch": {
    "agentic_ingest": {
      "policy": {
        "priority_topics": ["funding", "partnerships", "roadmap"],
        "deprioritized_topics": ["sync errors", "link formatting"],
        "priority_channels": ["cohort-planning", "governance"],
        "deprioritized_channels": ["bot-debug", "support-scratch"],
        "channel_labels": {
          "ops-war-room": "ops",
          "cohort-planning": "planning"
        },
        "custom_guidance": "Treat planning discussions in cohort channels as high-signal. Treat bot troubleshooting as low-signal unless it changes project direction."
      }
    }
  }
}
```

Turn agentic ingest off:

```json
{
  "patch": {
    "agentic_ingest": {
      "mode": "off"
    }
  }
}
```

Prioritize a bucket by narrowing scoped enrichment:

```json
{
  "patch": {
    "agentic_ingest": {
      "mode": "scoped",
      "scope": "scoped",
      "scoped_buckets": ["governance", "cohort"]
    }
  }
}
```
