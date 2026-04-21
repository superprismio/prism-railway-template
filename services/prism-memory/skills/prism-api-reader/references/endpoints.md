# Prism Reader Endpoints

Base URL:

```text
https://<prism-memory-domain>
```

Auth header:

```text
X-Prism-Api-Key: <read-key>
```

Examples:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/memory/latest"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/state/latest"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/knowledge/search?q=discord&limit=10"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/knowledge/docs/raidguild-handbook-home"
```
