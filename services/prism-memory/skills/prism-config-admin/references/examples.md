# Safe Patch Examples

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
