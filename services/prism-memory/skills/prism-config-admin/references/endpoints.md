# Prism Config Admin Endpoints

Read current config:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/config/space"
```

Patch current config:

```bash
curl -X PATCH \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  -H "X-Prism-Actor: codex" \
  -H "X-Prism-Reason: enable bot-only agentic ingest" \
  -H "Content-Type: application/json" \
  "$PRISM_API_BASE/config/space" \
  -d '{"patch":{"agentic_ingest":{"mode":"bot_only","scope":"bot_only"}}}'
```

Replace full config:

```bash
curl -X PUT \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  -H "X-Prism-Actor: codex" \
  -H "X-Prism-Reason: replace Prism space config" \
  -H "Content-Type: application/json" \
  "$PRISM_API_BASE/config/space" \
  -d @space-config.json
```

Read recent audit entries:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_API_BASE/ops/audit/recent?limit=20"
```

Run memory pipeline:

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  -H "X-Prism-Actor: codex" \
  -H "X-Prism-Reason: rerun memory pipeline after config update" \
  "$PRISM_API_BASE/ops/memory/run"
```

Run memory backfill:

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  -H "X-Prism-Actor: codex" \
  -H "X-Prism-Reason: 14 day backfill requested by operator" \
  "$PRISM_API_BASE/ops/memory/backfill?days=14&force=true"
```

Run knowledge pipeline:

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  -H "X-Prism-Actor: codex" \
  -H "X-Prism-Reason: refresh searchable knowledge after config change" \
  "$PRISM_API_BASE/ops/knowledge/run"
```
