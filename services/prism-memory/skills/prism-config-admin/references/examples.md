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
