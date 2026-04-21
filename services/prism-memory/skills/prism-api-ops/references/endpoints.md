# Ops Endpoint Patterns

Base URL:

```text
https://<prism-memory-domain>
```

Auth header:

```text
X-Prism-Api-Key: <ops-key>
```

Examples:

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/ops/memory/run?force=true"
```

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/ops/memory/backfill?days=30&force=true"
```

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/ops/knowledge/run"
```
